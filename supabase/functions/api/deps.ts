/**
 * Shared plumbing for the edge HTTP layer: the dependency container, auth
 * middleware, and small request helpers. Mirrors the semantics of the Fastify
 * plugins (`plugins/auth.ts`, TRUST_PROXY handling) — the business logic itself
 * lives in `shared/` and is byte-identical to the tested backend.
 */
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Database } from "./shared/db/client.ts";
import type { Env } from "./shared/env.ts";
import { payloadTooLarge, unauthorized } from "./shared/lib/http-errors.ts";
import type { PspProvider } from "./shared/providers/psp/index.ts";
import type { SmsProvider } from "./shared/providers/sms/index.ts";
import { verifyAccessToken } from "./shared/services/tokens.ts";

export interface Deps {
  db: Database;
  env: Env;
  sms: SmsProvider;
  psp: PspProvider;
  /** Injectable so tests can control time instead of sleeping. */
  now: () => number;
}

export interface AuthedUser {
  id: string;
}

/** Hono generics: what handlers may read from context. */
export type AppEnv = { Variables: { user?: AuthedUser; requestId?: string } };

export const MAX_JSON_BODY_BYTES = 64 * 1024;

/**
 * Bounded body parse for the production Hono adapter.
 *
 * Fastify enforces the same 64 KiB limit before its route handlers. Hono does
 * not, and `Request.json()` buffers the whole body, so an attacker could make
 * the deployed Edge function allocate an arbitrary payload before Zod ever saw
 * it. Read the stream incrementally and stop as soon as the byte budget is
 * crossed. Malformed JSON below the cap still becomes `{}` so Zod returns the
 * existing clean 400 contract.
 */
export async function readJson(c: Context, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const declared = c.req.header("content-length");
  if (declared !== undefined) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > maxBytes) throw payloadTooLarge();
  }

  const body = c.req.raw.body;
  if (!body) return {};

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The deliberate 413 below is the useful result even if cancellation
          // races with the client closing its upload stream.
        }
        throw payloadTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancelled stream may already have released its reader.
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
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
 * Signature, expiry, and subject are the complete authentication boundary.
 */
export function makeAuthenticate(deps: Deps) {
  return async (c: Context<AppEnv>, next: Next) => {
    const header = c.req.header("authorization");
    if (!header?.startsWith("Bearer "))
      throw unauthorized("missing_token", "Authorization header required");

    const claims = await verifyAccessToken(deps.env, header.slice(7));
    c.set("user", { id: claims.sub });
    await next();
  };
}

/** Narrows the context user for handlers behind `makeAuthenticate`. */
export function requireUser(c: Context<AppEnv>): AuthedUser {
  const user = c.get("user");
  if (!user) throw unauthorized();
  return user;
}
