/**
 * Cloudflare Worker: api.routino.me → the Supabase Edge Function.
 *
 * Why it exists:
 *  - Iranian users reach Cloudflare's edge reliably; the raw *.supabase.co URL
 *    is both uglier and less certain.
 *  - It stamps `x-proxy-secret`, so the function can refuse anything that did
 *    NOT come through this worker (the raw URL is dead), and `x-client-ip`
 *    (from cf-connecting-ip) becomes a trustworthy source for OTP rate limits.
 *
 * Deploy (Cloudflare dashboard, no CLI needed):
 *  1. Workers & Pages → Create → Worker → paste this file → Deploy.
 *  2. Worker → Settings → Variables → add secret PROXY_SECRET
 *     (same value as the Supabase function's PROXY_SECRET).
 *  3. Worker → Settings → Domains & Routes → add custom domain: api.routino.me
 *
 * Path mapping: api.routino.me/<path> → <SUPABASE>/functions/v1/api/<path>.
 * The function's Hono app has basePath("/api"), so public paths (/v1/...,
 * /admin, /health) are byte-identical to the old Fastify deployment — the
 * frontend, the payment callbacks and the admin panel need no changes.
 */

const ORIGIN = "https://axychfrteevhfdhgvfuv.supabase.co/functions/v1/api";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = ORIGIN + url.pathname + url.search;

    const headers = new Headers(request.headers);
    headers.set("x-proxy-secret", env.PROXY_SECRET ?? "");
    headers.set("x-client-ip", request.headers.get("cf-connecting-ip") ?? "");

    return fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      // Pass gateway redirects (e.g. nothing today, but harmless) through to
      // the browser instead of following them server-side.
      redirect: "manual",
    });
  },
};
