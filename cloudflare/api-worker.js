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
 * Deploy: from git. Cloudflare Workers Builds watches `main` and redeploys this
 * file on every push, using `cloudflare/wrangler.toml` — so DO NOT edit this
 * Worker in the dashboard, or the next push will silently overwrite the edit.
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const target = ORIGIN + url.pathname + url.search;

    const cacheable = request.method === "GET" && CACHEABLE.has(url.pathname);
    const key = cacheable ? cacheKey(url, request) : null;
    if (key) {
      const hit = await caches.default.match(key);
      if (hit) return hit;
    }

    const headers = new Headers(request.headers);
    headers.set("x-proxy-secret", env.PROXY_SECRET ?? "");
    headers.set("x-client-ip", request.headers.get("cf-connecting-ip") ?? "");

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
      // Only had to go because it pinned the browser to the wrong text/plain
      // type; now that content-type is corrected above, it is safe and wanted.
      h.set("x-content-type-options", "nosniff");
      // The blanket delete above is what strips the gateway's sandbox CSP. For
      // /admin we then put OUR own back: that page holds the admin token, so it
      // is the one page here worth a CSP at all. 'unsafe-inline' is unavoidable
      // (the panel's script is inline), but blocking every external origin
      // still leaves an injected <script src> or an exfiltration beacon nowhere
      // to go. Deliberately NOT applied to the payment result page: it
      // navigates to the routino:// deep link to return to the Android app, and
      // that flow is not worth risking for a defence-in-depth header.
      if (new URL(request.url).pathname.startsWith("/admin")) {
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

    // Only a 200 is worth keeping: caching a 500 from a momentarily unhealthy
    // function would pin the paywall to "no plans" for the next five minutes.
    if (key && resp.status === 200) {
      // Read the body out rather than forwarding the stream. Supabase answers
      // with whatever encoding THIS caller asked for, and the runtime decodes on
      // read — so storing the stream plus its `content-encoding` header would
      // hand a later caller a body whose declared encoding is a lie. The payload
      // is a few hundred bytes; Cloudflare re-compresses on the way out anyway.
      const body = await resp.text();
      const h = new Headers(resp.headers);
      h.delete("content-encoding");
      h.delete("content-length");
      h.set("cache-control", `public, max-age=${CACHE_SECONDS}`);
      const cached = new Response(body, { status: 200, headers: h });
      // put() consumes the body, so the caller gets a clone. waitUntil keeps the
      // write off the response path — the first visitor should not pay for it.
      // A refused write (the Cache API rejects some responses outright) must
      // stay invisible: the answer is already correct, it just isn't stored.
      ctx.waitUntil(caches.default.put(key, cached.clone()).catch(() => {}));
      return cached;
    }

    return resp;
  },
};
