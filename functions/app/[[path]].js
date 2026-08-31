/**
 * SPA fallback for /app/* — as a Pages Function, not a `_redirects` rule.
 *
 * Why not `_redirects`? It was tried first (`/app/* /app/index.html 200`) and
 * did not take effect on the live site: /app/ worked because it is a real
 * file, but /app/habits, /app/settings and /app/pay/result all returned the
 * ROOT index.html — the marketing page — instead of the app. Making the file
 * ASCII-only did not change it either. Whatever the cause (Pages appears to
 * fall back every unknown path to the root index.html before the rule is
 * considered), a Function runs ahead of the asset router and is unambiguous.
 *
 * That last URL is why this matters beyond a broken bookmark:
 * /app/pay/result is where the payment gateway returns a paying user, and it
 * was rendering the landing page — so someone who had just paid would see a
 * "install the app" pitch instead of their subscription being confirmed.
 *
 * `_routes.json` excludes assets, sw.js, the manifest and icons before this
 * Function is invoked. The extension check remains fail-safe for a future file
 * that is not yet excluded. Only extension-less paths get the app shell.
 */
const APP_SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "font-src 'self'; img-src 'self' data: blob: https://trustseal.enamad.ir; " +
    "connect-src 'self' https://api.routino.me; worker-src 'self' blob:; " +
    "manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
    "frame-ancestors 'none'; upgrade-insecure-requests",
};

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // A real file under /app/ — let the asset server answer it.
  if (/\.[a-zA-Z0-9]+$/.test(url.pathname)) return next();

  const shell = await env.ASSETS.fetch(new URL("/app/index.html", url.origin));

  // Pages applies `_headers` to the app shell. Preserve those security headers
  // when re-wrapping it for a client-side route; otherwise the fallback path
  // would silently lose CSP, clickjacking and MIME protections.
  const headers = new Headers(shell.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-cache");
  for (const [name, value] of Object.entries(APP_SECURITY_HEADERS)) headers.set(name, value);

  // Re-wrap so the status is 200 for the route the browser actually asked for,
  // and so the shell is never cached under a route URL (it would then be
  // served for a different route after a deploy).
  return new Response(shell.body, {
    status: 200,
    headers,
  });
}
