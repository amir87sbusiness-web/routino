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
 * Deploy (Cloudflare dashboard, no CLI needed):
 *  1. Workers & Pages → Create → Worker → paste this file → Deploy.
 *  2. Worker → Settings → Variables → add secret PROXY_SECRET
 *     (same value as the Supabase function's PROXY_SECRET).
 *  3. Worker → Settings → Domains & Routes → add custom domain: api.routino.me
 *
 * Path mapping: api.routino.me/<path> → <SUPABASE>/functions/v1/api/<path>.
 * The function's Hono app has basePath("/api"), so public paths (/v1/...,
 * /admin, /health) are byte-identical to the old Fastify deployment.
 */

const ORIGIN = "https://axychfrteevhfdhgvfuv.supabase.co/functions/v1/api";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = ORIGIN + url.pathname + url.search;

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

    return resp;
  },
};
