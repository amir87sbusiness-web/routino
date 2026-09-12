const ZARINPAL_ORIGIN = "https://payment.zarinpal.com";
const RELAY_PREFIX = "/_zarinpal";
const RELAY_SECRET_SHA256 = "abc3ee9d2cdb1963bfd20a77b6eeb971c12f8a9eb8b8ba960a28a93550279931";
const MAX_BODY_BYTES = 32 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const ALLOWED_PATHS = new Set([
  "/pg/v4/payment/request.json",
  "/pg/v4/payment/verify.json",
  "/pg/v4/payment/unVerified.json",
]);

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-routino-zarinpal-relay": "pages",
    },
  });

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function equalHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authorized(request) {
  const secret = request.headers.get("x-proxy-secret") || "";
  if (secret.length < 32 || secret.length > 256) return false;
  return equalHex(await sha256Hex(secret), RELAY_SECRET_SHA256);
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

async function selftest() {
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
        description: "routino-pages-relay-selftest",
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
        error: String(err?.message || err),
      },
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest({ request }) {
  const url = new URL(request.url);

  if (!(await authorized(request))) return json({ error: "forbidden" }, 403);

  if (request.method === "GET" && url.pathname === `${RELAY_PREFIX}/selftest`) {
    return selftest();
  }

  const upstreamPath = url.pathname.slice(RELAY_PREFIX.length);
  if (!ALLOWED_PATHS.has(upstreamPath)) return json({ error: "not_found" }, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await readBoundedBody(request);
  if (body === null) return json({ error: "body_too_large" }, 413);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${ZARINPAL_ORIGIN}${upstreamPath}${url.search}`, {
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
    headers.set("x-routino-zarinpal-relay", "pages");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (err) {
    return json(
      {
        error: err?.name === "AbortError" ? "upstream_timeout" : "upstream_error",
      },
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}
