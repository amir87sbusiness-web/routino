/**
 * Shared plumbing for the edge HTTP layer: the dependency container, auth
 * middleware, and small request helpers. Mirrors the semantics of the Fastify
 * plugins (`plugins/auth.ts`, TRUST_PROXY handling) — the business logic itself
 * lives in `shared/` and is byte-identical to the tested backend.
 */
import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { users } from "./shared/db/schema.ts";
import type { Database } from "./shared/db/client.ts";
import type { Env } from "./shared/env.ts";
import { forbidden, unauthorized } from "./shared/lib/http-errors.ts";
import type { PspRouter } from "./shared/providers/psp/index.ts";
import type { SmsProvider } from "./shared/providers/sms/index.ts";
import { verifyAccessToken } from "./shared/services/tokens.ts";

export interface Deps {
  db: Database;
  env: Env;
  sms: SmsProvider;
  psp: PspRouter;
  /** Injectable so tests can control time instead of sleeping. */
  now: () => number;
}

export interface AuthedUser {
  id: string;
  phone: string;
  deviceId: string;
}

/** Hono generics: what handlers may read from context. */
export type AppEnv = { Variables: { user?: AuthedUser } };

/** Body parse that never throws: malformed JSON becomes `{}`, which zod then
 * rejects as a clean 400 instead of a 500. */
export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

/**
 * Serve an HTML page.
 *
 * The Supabase Edge Functions gateway force-downgrades HTML responses on the
 * *.supabase.co domain to `text/plain` and slaps a `sandbox` CSP on them (an
 * anti-phishing measure for the shared domain). That would render the admin
 * panel and the payment-result page as raw source with their inline scripts
 * blocked. So we mark HTML responses with `x-routino-html`, and the Cloudflare
 * Worker in front of api.routino.me — which serves from OUR domain — restores
 * `text/html` and strips the sandbox CSP. Locally (Fastify / tests) the header
 * is simply harmless.
 */
export function html(c: Context, body: string, status?: ContentfulStatusCode) {
  c.header("x-routino-html", "1");
  return c.html(body, status);
}

/**
 * Client IP for the OTP rate limits — the edge analogue of TRUST_PROXY.
 *
 * When PROXY_SECRET is enforced, every request provably came through our
 * Cloudflare Worker, which sets `x-client-ip` from `cf-connecting-ip`; that
 * header is then trustworthy. Without the secret (local dev/tests) we fall back
 * to the LAST x-forwarded-for hop — appended by the nearest gateway, so a
 * client cannot spoof it by prepending entries.
 */
export function clientIp(c: Context, env: Env): string | null {
  if (env.PROXY_SECRET) return c.req.header("x-client-ip") || null;
  const fwd = c.req.header("x-forwarded-for");
  if (!fwd) return null;
  const last = fwd.split(",").at(-1)?.trim();
  return last || null;
}

/**
 * Bearer auth middleware.
 *
 * Re-reads the user row on every request rather than trusting the JWT alone —
 * that's what makes blocking take effect within the access-token TTL instead of
 * whenever the token happens to expire. (Same contract as the Fastify plugin.)
 */
export function makeAuthenticate(deps: Deps) {
  return async (c: Context<AppEnv>, next: Next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer "))
      throw unauthorized("missing_token", "Authorization header required");

    const claims = await verifyAccessToken(deps.env, header.slice(7));
    const [row] = await deps.db.select().from(users).where(eq(users.id, claims.sub)).limit(1);

    if (!row) throw unauthorized("unknown_user", "User no longer exists");
    if (row.blocked) throw forbidden("blocked", "Account is blocked");

    c.set("user", { id: row.id, phone: row.phone, deviceId: claims.did });
    await next();
  };
}

/** Narrows the context user for handlers behind `makeAuthenticate`. */
export function requireUser(c: Context<AppEnv>): AuthedUser {
  const user = c.get("user");
  if (!user) throw unauthorized();
  return user;
}
