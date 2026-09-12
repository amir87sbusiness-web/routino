/**
 * Same-origin API bridge for the web app plus a private ZarinPal relay.
 *
 * `/v1/_zarinpal/*` is server-only and terminates at Cloudflare Pages. Every
 * other `/v1/*` path continues to api.routino.me exactly as before.
 */
const API_ORIGIN = "https://api.routino.me";
const ZARINPAL_ORIGIN = "https://payment.zarinpal.com";
const ZARINPAL_RELAY_PREFIX = "/v1/_zarinpal";
const MAX_BODY_BYTES = 64 * 1024;
const ZARINPAL_TIMEOUT_MS = 20_000;
const RELAY_AUTH_TTL_MS = 5 * 60 * 1000;
const ZARINPAL_PATHS = new Set([
  "/pg/v4/payment/request.json",
  "/pg/v4/payment/verify.json",
  "/pg/v4/payment/unVerified.json",
]);
const RELAY_AUTH_CACHE = new Map();

const relayJson = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-routino-zarinpal-relay": "pages-v1",
    },
  });

async function sha256Hex(value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function relayAuthorized(request) {
  const secret = request.headers.get("x-proxy-secret") || "";
  if (secret.length < 32 || secret.length > 256) return false;

  const key = await sha256Hex(secret);
  const cachedUntil = RELAY_AUTH_CACHE.get(key) || 0;
  if (cachedUntil > Date.now()) return true;

  try {
    const validation = await fetch(`${API_ORIGIN}/internal/payments/relay-auth`, {
      method: "POST",
      headers: { "x-relay-candidate": secret },
      cache: "no-store",
      redirect: "manual",
    });
    if (validation.status !== 204) return false;
    RELAY_AUTH_CACHE.set(key, Date.now() + RELAY_AUTH_TTL_MS);
    return true;
  } catch {
    return false;
  }
}

async function readBoundedBody(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function zarinpalSelftest() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  const started = Date.now();
  try {
    const upstream = await fetch(`${ZARINPAL_ORIGIN}/pg/v4/payment/request.json`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        merchant_id: "00000000-0000-0000-0000-000000000000",
        amount: 10_000,
        currency: "IRR",
        description: "routino-zarinpal-relay-selftest",
        callback_url: "https://routino.me",
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const sample = (await upstream.text()).slice(0, 240);
    return relayJson({
      reachable: true,
      status: upstream.status,
      ms: Date.now() - started,
      sample,
    });
  } catch (err) {
    return relayJson(
      { reachable: false, ms: Date.now() - started, error: String(err?.message || err) },
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function handleZarinpalRelay(request, incoming) {
  if (!(await relayAuthorized(request))) return relayJson({ error: "forbidden" }, 403);

  if (request.method === "GET" && incoming.pathname === `${ZARINPAL_RELAY_PREFIX}/selftest`) {
    return zarinpalSelftest();
  }

  const upstreamPath = incoming.pathname.slice(ZARINPAL_RELAY_PREFIX.length);
  if (!ZARINPAL_PATHS.has(upstreamPath)) return relayJson({ error: "not_found" }, 404);
  if (request.method !== "POST") return relayJson({ error: "method_not_allowed" }, 405);

  const body = await readBoundedBody(request);
  if (body === null) return relayJson({ error: "body_too_large" }, 413);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ZARINPAL_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${ZARINPAL_ORIGIN}${upstreamPath}${incoming.search}`, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type") || "application/json",
        accept: request.headers.get("accept") || "application/json",
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    const headers = new Headers();
    headers.set("content-type", upstream.headers.get("content-type") || "application/json");
    headers.set("cache-control", "no-store");
    headers.set("x-routino-zarinpal-relay", "pages-v1");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (err) {
    return relayJson(
      { error: err?.name === "AbortError" ? "upstream_timeout" : "upstream_error" },
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest({ request }) {
  const incoming = new URL(request.url);

  if (incoming.pathname.startsWith(`${ZARINPAL_RELAY_PREFIX}/`)) {
    return handleZarinpalRelay(request, incoming);
  }

  const target = new URL(`${incoming.pathname}${incoming.search}`, API_ORIGIN);

  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody ? await readBoundedBody(request) : undefined;
    if (body === null) {
      return Response.json(
        { error: "body_too_large" },
        { status: 413, headers: { "cache-control": "no-store", "x-routino-pages-proxy": "1" } },
      );
    }
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("content-length");
    requestHeaders.delete("host");
    const upstream = await fetch(
      new Request(target, {
        method: request.method,
        headers: requestHeaders,
        body,
        redirect: "manual",
      }),
    );
    const headers = new Headers(upstream.headers);
    headers.delete("set-cookie");
    headers.set("x-routino-pages-proxy", "1");
    headers.set("access-control-expose-headers", "x-request-id, retry-after");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    return Response.json(
      { error: "api_unavailable" },
      { status: 502, headers: { "cache-control": "no-store", "x-routino-pages-proxy": "1" } },
    );
  }
}
