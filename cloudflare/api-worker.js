/**
 * Cloudflare Worker: api.routino.me → the Supabase Edge Function.
 *
 * Why it exists:
 *  - Iranian users reach Cloudflare's edge reliably; the raw *.supabase.co URL
 *    is both uglier and less certain.
 *  - It stamps `x-proxy-secret`, so the function can refuse anything that did
 *    NOT come through this worker (the raw URL is dead), and `x-client-ip`
 *    (from cf-connecting-ip) becomes a trustworthy source for OTP rate limits.
 *  - It repairs HTML responses. Supabase force-downgrades HTML on *.supabase.co
 *    to `text/plain` + a `sandbox` CSP (anti-phishing for the shared domain),
 *    which would render the admin panel and the payment-result page as raw
 *    source with their inline scripts blocked. The function marks HTML with
 *    `x-routino-html`; here — on OUR domain — we restore `text/html` and drop
 *    the sandbox CSP.
 *
 * Deploy from the repository with
 * `npx wrangler deploy --config cloudflare/wrangler.toml`. The config targets
 * the existing `routino-api` service that owns api.routino.me; a different name
 * creates a second Worker and leaves production unchanged.
 *
 * One-time dashboard setup (already done, listed for when it has to be redone):
 *  1. Worker → Settings → Build → connect the repo, Root directory = `cloudflare`
 *  2. Worker → Settings → Variables → Secrets → PROXY_SECRET
 *     (identical to the Supabase function's PROXY_SECRET, or every request 403s)
 *  3. Worker → Settings → Domains & Routes → custom domain: api.routino.me
 *
 * Path mapping: api.routino.me/<path> → <SUPABASE>/functions/v1/api/<path>.
 * The function's Hono app has basePath("/api"), so public paths (/v1/...,
 * /admin, /health) are byte-identical to the old Fastify deployment.
 */

const ORIGIN = "https://axychfrteevhfdhgvfuv.supabase.co/functions/v1/api";

/**
 * GET paths whose answer is the same for everyone and changes only when the
 * owner edits it. Caching them here is worth more than it looks: measured from
 * Iran, `/v1/plans` costs ~1.05s (Tehran → Cloudflare → Stockholm → Postgres and
 * back) and it sits on the paywall — the one screen where a delay costs money.
 * From the Cloudflare edge it is tens of milliseconds, and it stops burning a
 * Supabase function invocation per view.
 */
const CACHEABLE = new Set(["/v1/plans"]);
/** A price edited in the admin panel goes live at most this late. */
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

  const resp = await fetch(target, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  });

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
          "img-src 'self' data:; connect-src 'self'; form-action 'self'; " +
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
            "access-control-allow-headers": "authorization, content-type, x-admin-token",
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
