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
 * Files keep their normal handling: anything with an extension (assets,
 * sw.js, manifest.webmanifest, icons) is passed straight through, so hashed
 * assets and the service worker are served as themselves. Only extension-less
 * paths — which are exactly the client-side routes — get the app shell.
 */
export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  // A real file under /app/ — let the asset server answer it.
  if (/\.[a-zA-Z0-9]+$/.test(url.pathname)) return next();

  const shell = await env.ASSETS.fetch(new URL("/app/index.html", url.origin));

  // Re-wrap so the status is 200 for the route the browser actually asked for,
  // and so the shell is never cached under a route URL (it would then be
  // served for a different route after a deploy).
  return new Response(shell.body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
