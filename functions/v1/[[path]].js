/**
 * Same-origin API bridge for the web app.
 *
 * The browser bundle intentionally calls `/v1` so it works offline without
 * baking an environment-specific host into every asset. Cloudflare Pages must
 * therefore send only that namespace to the API Worker; every other path stays
 * with Pages/assets.
 */
const API_ORIGIN = "https://api.routino.me";

export async function onRequest({ request }) {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, API_ORIGIN);

  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstream = await fetch(
      new Request(target, {
        method: request.method,
        headers: request.headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
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
