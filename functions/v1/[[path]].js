/**
 * Same-origin API bridge for the web app.
 *
 * The browser bundle intentionally calls `/v1` so it works offline without
 * baking an environment-specific host into every asset. Cloudflare Pages must
 * therefore send only that namespace to the API Worker; every other path stays
 * with Pages/assets.
 */
const API_ORIGIN = "https://api.routino.me";
const MAX_BODY_BYTES = 64 * 1024;

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

export async function onRequest({ request }) {
  const incoming = new URL(request.url);
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
    // API auth is header/token based. Never let an upstream infrastructure
    // cookie become a first-party routino.me cookie through this bridge.
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
