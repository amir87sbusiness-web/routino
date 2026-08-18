const encoder = new TextEncoder();
const ALLOWED_PATHS = new Set(["/v1/request", "/v1/verify"]);
const MAX_BODY_BYTES = 8 * 1024;
const MAX_CLOCK_SKEW_MS = 60_000;
const MAX_NONCES = 2_048;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export async function signRelayRequest({ secret, timestamp, nonce, path, body }) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}\n${nonce}\n${path}\n${body}`),
  );
  return toHex(new Uint8Array(signed));
}

function equalHex(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

const json = (value, status) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });

export function createRelayHandler({ merchant, secret, fetchImpl = fetch, now = Date.now }) {
  const nonces = new Map();

  return async function relay(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "routino-payment-relay" }, 200);
    }
    if (request.method !== "POST" || !ALLOWED_PATHS.has(url.pathname)) {
      return json({ error: "not_found" }, 404);
    }

    const body = await request.text();
    if (encoder.encode(body).byteLength > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }

    const timestamp = request.headers.get("x-routino-timestamp") ?? "";
    const nonce = request.headers.get("x-routino-nonce") ?? "";
    const timestampMs = Number(timestamp);
    const currentTime = now();
    if (
      !Number.isSafeInteger(timestampMs) ||
      Math.abs(currentTime - timestampMs) > MAX_CLOCK_SKEW_MS ||
      !UUID_V4.test(nonce)
    ) {
      return json({ error: "unauthorized" }, 401);
    }

    const expected = await signRelayRequest({ secret, timestamp, nonce, path: url.pathname, body });
    const supplied = request.headers.get("x-routino-signature") ?? "";
    if (!equalHex(supplied, expected)) {
      return json({ error: "unauthorized" }, 401);
    }

    for (const [seenNonce, expiresAt] of nonces) {
      if (expiresAt < currentTime) nonces.delete(seenNonce);
    }
    if (nonces.has(nonce)) return json({ error: "replayed_request" }, 409);
    if (nonces.size >= MAX_NONCES) nonces.delete(nonces.keys().next().value);
    nonces.set(nonce, currentTime + MAX_CLOCK_SKEW_MS);

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "invalid_json" }, 400);
    }

    const payload = { ...parsed, merchant };
    try {
      const upstream = await fetchImpl(`https://gateway.zibal.ir${url.pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12_000),
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "application/json",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return json({ error: "upstream_unavailable" }, 502);
    }
  };
}
