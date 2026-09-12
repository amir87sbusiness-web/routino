/**
 * Cloudflare Worker: api.routino.me → the Supabase Edge Function.
 *
 * It also exposes a PRIVATE server-to-server ZarinPal relay under
 * `/_zarinpal/*`. Supabase Edge calls that relay with the same shared secret the
 * Worker and Edge already use, so request/verify never need a direct
 * Supabase→ZarinPal connection. StartPay still opens directly on ZarinPal in the
 * customer's browser.
 */

const ORIGIN = "https://axychfrteevhfdhgvfuv.supabase.co/functions/v1/api";
const ZARINPAL_ORIGIN = "https://payment.zarinpal.com";
const ZARINPAL_PROXY_PREFIX = "/_zarinpal";
const ZARINPAL_PROXY_TIMEOUT_MS = 20_000;

/**
 * Keep dynamic money data out of the explicit Worker Cache API. In particular,
 * `/v1/plans` backs the checkout screen and must reflect a database price edit
 * immediately; latency is preferable to displaying or charging around a stale
 * catalog. The cache plumbing stays available for future non-financial public
 * GETs whose staleness is harmless.
 */
const CACHEABLE = new Set();
const CACHE_SECONDS = 300;
const ALLOWED_ORIGINS = new Set([
  "https://routino.me",
  "https://www.routino.me",
  "capacitor://localhost",
  "https://localhost",
  "http://localhost:5173",
  "http://localhost:5180",
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** One promise per public cache key, scoped to this Worker isolate. */
const IN_FLIGHT = new Map();

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

/**
 * Private transparent ZarinPal relay, modelled after Sheetra's working payment
 * proxy. It accepts only authenticated /pg/* POSTs and strips the proxy secret
 * before forwarding to ZarinPal.
 */
async function proxyZarinpal(request, env, url) {
  const expected = env.ZARINPAL_PROXY_SECRET || env.PROXY_SECRET || "";
  if (!expected) return json({ error: "zarinpal proxy secret is not configured" }, 503);
  if (request.headers.get("x-proxy-secret") !== expected) {
    return json({ error: "forbidden" }, 403);
  }

  if (request.method === "GET" && url.pathname === `${ZARINPAL_PROXY_PREFIX}/selftest`) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const started = Date.now();
    try {
      const upstream = await fetch(`${ZARINPAL_ORIGIN}/pg/v4/payment/request.json`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchant_id: "00000000-0000-0000-0000-000000000000",
          amount: 10_000,
          currency: "IRR",
          description: "routino-proxy-selftest",
          callback_url: "https://routino.me",
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      const sample = (await upstream.text()).slice(0, 240);
      return json({ reachable: true, status: upstream.status, ms: Date.now() - started, sample });
    } catch (err) {
      return json(
        {
          reachable: false,
          ms: Date.now() - started,
          error: String((err && err.message) || err),
        },
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  const upstreamPath = url.pathname.slice(ZARINPAL_PROXY_PREFIX.length);
  if (!upstreamPath.startsWith("/pg/")) return json({ error: "not found" }, 404);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ZARINPAL_PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${ZARINPAL_ORIGIN}${upstreamPath}${url.search}`, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") || "application/json",
        accept: request.headers.get("accept") || "application/json",
      },
      body: await request.text(),
      signal: controller.signal,
      cache: "no-store",
    });
    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") || "application/json");
    headers.set("cache-control", "no-store");
    return new Response(await upstream.text(), { status: upstream.status, headers });
  } catch (err) {
    const aborted = err && err.name === "AbortError";
    return json(
      {
        error: aborted ? "upstream timeout" : "upstream error",
        detail: String((err && err.message) || err),
      },
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cache key for a cacheable path.
 *
 * Keyed by Origin because the CORS layer *echoes* the caller's origin into
 * `Access-Control-Allow-Origin`. One shared entry would hand routino.me's header
 * to a Capacitor caller (or the reverse) and the browser would reject the
 * response. The origin list is short (the site, localhost, capacitor://) so this
 * is a handful of entries, not a fan-out. Deliberately NOT solved with `Vary`:
 * the response already carries `Vary: Origin`, and Cloudflare's cache treats
 * anything varying on more than Accept-Encoding as uncacheable — which is
 * exactly why this needs the explicit Cache API rather than a header.
 */
const cacheKey = (url, request) =>
  new Request(
    `${url.origin}${url.pathname}?__origin=${encodeURIComponent(request.headers.get("origin") ?? "")}`,
    { method: "GET" },
  );

const requestIdFor = (request) => {
  const inbound = request.headers.get("x-request-id") ?? "";
  return UUID_V4.test(inbound) ? inbound : crypto.randomUUID();
};

const stamped = (response, requestId, cacheState, requestOrigin = "") => {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-routino-cache", cacheState);
  headers.set("access-control-expose-headers", "x-request-id, retry-after, x-routino-cache");
  if (ALLOWED_ORIGINS.has(requestOrigin)) {
    headers.set("access-control-allow-origin", requestOrigin);
    headers.set("access-control-allow-credentials", "true");
    headers.append("vary", "Origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

async function fetchOrigin(request, env, ctx, url, key, requestId) {
  const target = ORIGIN + url.pathname + url.search;
  const headers = new Headers(request.headers);
  headers.set("x-proxy-secret", env.PROXY_SECRET ?? "");
  headers.set("x-client-ip", request.headers.get("cf-connecting-ip") ?? "");
  headers.set("x-request-id", requestId);

  const livePricing = request.method === "GET" && url.pathname === "/v1/plans";
  const resp = await fetch(target, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
    cache: livePricing ? "no-store" : undefined,
  });

  // The checkout catalog is deliberately non-cacheable end-to-end. This also
  // prevents a browser or an outer Cloudflare cache rule from retaining it.
  if (livePricing) {
    const h = new Headers(resp.headers);
    h.delete("set-cookie");
    h.set("cache-control", "no-store");
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: h,
    });
  }

  // Repair HTML pages the Supabase gateway downgraded to text/plain + sandbox.
  if (resp.headers.get("x-routino-html") === "1") {
    const h = new Headers(resp.headers);
    h.set("content-type", "text/html; charset=utf-8");
    h.delete("content-security-policy");
    h.set("x-content-type-options", "nosniff");
    if (url.pathname.startsWith("/admin")) {
      h.set(
        "content-security-policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; font-src https://cdn.jsdelivr.net; connect-src 'self'; form-action 'self'; " +
          "frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
      );
    }
    h.delete("x-routino-html");
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: h,
    });
  }

  // Only a 200 is worth keeping: never pin a temporary upstream failure.
  if (key && resp.status === 200) {
    const body = await resp.text();
    const h = new Headers(resp.headers);
    h.delete("content-encoding");
    h.delete("content-length");
    h.delete("set-cookie");
    // Request IDs belong to callers, not shared cache entries.
    h.delete("x-request-id");
    h.set("cache-control", `public, max-age=${CACHE_SECONDS}`);
    const cached = new Response(body, { status: 200, headers: h });
    ctx.waitUntil(caches.default.put(key, cached.clone()).catch(() => {}));
    return cached;
  }

  return resp;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const requestId = requestIdFor(request);
    const requestOrigin = request.headers.get("origin") ?? "";

    // Server-only ZarinPal relay. Handle this before any browser/CORS logic and
    // never forward its private path to Supabase.
    if (url.pathname.startsWith(`${ZARINPAL_PROXY_PREFIX}/`)) {
      return stamped(await proxyZarinpal(request, env, url), requestId, "LOCAL", "");
    }

    // A liveness answer does not need a function invocation or a database read.
    // `/health/ready` deliberately continues upstream for a real readiness check.
    if (request.method === "GET" && url.pathname === "/health") {
      return stamped(
        new Response(JSON.stringify({ ok: true, edge: "cloudflare" }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        }),
        requestId,
        "LOCAL",
        requestOrigin,
      );
    }

    // Preflights are protocol work: keep them at Cloudflare and never spend a
    // Supabase invocation just to repeat the same allow-list response.
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(requestOrigin)) {
        return stamped(new Response(null, { status: 403 }), requestId, "LOCAL", requestOrigin);
      }
      return stamped(
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": requestOrigin,
            "access-control-allow-credentials": "true",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "authorization, content-type, x-admin-csrf",
            "access-control-max-age": "86400",
            vary: "Origin",
          },
        }),
        requestId,
        "LOCAL",
        requestOrigin,
      );
    }

    const cacheable = request.method === "GET" && CACHEABLE.has(url.pathname);
    const key = cacheable ? cacheKey(url, request) : null;
    if (key) {
      const hit = await caches.default.match(key);
      if (hit) return stamped(hit, requestId, "HIT", requestOrigin);
    }

    if (key) {
      const inFlightKey = key.url;
      const existing = IN_FLIGHT.get(inFlightKey);
      const pending =
        existing ??
        fetchOrigin(request, env, ctx, url, key, requestId).finally(() => {
          IN_FLIGHT.delete(inFlightKey);
        });
      if (!existing) IN_FLIGHT.set(inFlightKey, pending);
      const response = await pending;
      return stamped(response.clone(), requestId, existing ? "COALESCED" : "MISS", requestOrigin);
    }

    const response = await fetchOrigin(request, env, ctx, url, null, requestId);
    return stamped(response, requestId, "BYPASS", requestOrigin);
  },
};
