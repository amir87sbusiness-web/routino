// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/** Durable, low-growth fixed-window authentication throttles. */
import { createHmac } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { authRateLimitBuckets } from "../db/schema.ts";
import type { Env } from "../env.ts";

const WINDOW_SECONDS = 900;
const WINDOW_MS = WINDOW_SECONDS * 1000;
const LIMITS = {
  perIdentifierSoft: 8,
  perIdentifierHard: 50,
  perIp: 50,
} as const;
const ADMIN_LIMIT = 10;

type Scope = "login_identifier" | "login_ip" | "admin_otp_ip";

export interface LoginRateVerdict {
  ok: boolean;
  verifyOnly?: boolean;
  retryAfter?: number;
  reason?: "identifier" | "ip";
}

const windowStart = (now: Date): Date =>
  new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
const expiresAt = (start: Date): Date => new Date(start.getTime() + WINDOW_MS);
const secondsUntilReset = (now: Date): number =>
  Math.max(1, Math.ceil((expiresAt(windowStart(now)).getTime() - now.getTime()) / 1000));

const keyHash = (env: Env, scope: Scope, value: string): string =>
  createHmac("sha256", env.OTP_PEPPER).update(`${scope}\0${value}`).digest("hex");

async function readCount(
  db: Database,
  env: Env,
  scope: Scope,
  value: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ count: authRateLimitBuckets.count })
    .from(authRateLimitBuckets)
    .where(
      and(
        eq(authRateLimitBuckets.scope, scope),
        eq(authRateLimitBuckets.keyHash, keyHash(env, scope, value)),
        eq(authRateLimitBuckets.windowStart, windowStart(now)),
      ),
    );
  return row?.count ?? 0;
}

async function increment(
  db: Database,
  env: Env,
  scope: Scope,
  value: string,
  now: Date,
): Promise<number> {
  const start = windowStart(now);
  const [row] = await db
    .insert(authRateLimitBuckets)
    .values({
      scope,
      keyHash: keyHash(env, scope, value),
      windowStart: start,
      count: 1,
      expiresAt: expiresAt(start),
    })
    .onConflictDoUpdate({
      target: [
        authRateLimitBuckets.scope,
        authRateLimitBuckets.keyHash,
        authRateLimitBuckets.windowStart,
      ],
      set: {
        count: sql`${authRateLimitBuckets.count} + 1`,
        expiresAt: expiresAt(start),
      },
    })
    .returning();
  if (!row) throw new Error("rate-limit increment returned no row");
  return row.count;
}

export async function checkLoginRate(
  db: Database,
  env: Env,
  ip: string | null,
  identifier: string,
  now: Date,
): Promise<LoginRateVerdict> {
  const failures = await readCount(db, env, "login_identifier", identifier, now);
  if (failures >= LIMITS.perIdentifierHard) {
    return { ok: false, retryAfter: secondsUntilReset(now), reason: "identifier" };
  }
  if (ip && (await readCount(db, env, "login_ip", ip, now)) >= LIMITS.perIp) {
    return { ok: false, retryAfter: secondsUntilReset(now), reason: "ip" };
  }
  if (failures >= LIMITS.perIdentifierSoft) {
    return { ok: true, verifyOnly: true, retryAfter: secondsUntilReset(now), reason: "identifier" };
  }
  return { ok: true };
}

/** Claim one admin request before checking the submitted phone. This uses only
 * the trusted client IP, so arbitrary phone guesses cannot create DB rows. */
export async function claimAdminOtpRequest(
  db: Database,
  env: Env,
  ip: string | null,
  now: Date,
): Promise<LoginRateVerdict> {
  const count = await increment(db, env, "admin_otp_ip", ip ?? "unknown", now);
  return count <= ADMIN_LIMIT
    ? { ok: true }
    : { ok: false, retryAfter: secondsUntilReset(now), reason: "ip" };
}

/** Compatibility for the legacy shared-token guard until the OTP route unit
 * replaces it. Correct tokens are still checked before these functions run. */
export async function checkAdminRate(
  db: Database,
  env: Env,
  ip: string | null,
  now: Date,
): Promise<LoginRateVerdict> {
  const count = await readCount(db, env, "admin_otp_ip", ip ?? "unknown", now);
  return count >= ADMIN_LIMIT
    ? { ok: false, retryAfter: secondsUntilReset(now), reason: "ip" }
    : { ok: true };
}

export async function recordAdminFailure(
  db: Database,
  env: Env,
  ip: string | null,
  now: Date,
): Promise<void> {
  await increment(db, env, "admin_otp_ip", ip ?? "unknown", now);
}

export async function recordLoginFailure(
  db: Database,
  env: Env,
  ip: string | null,
  identifier: string,
  now: Date,
  options: { trackIdentifier: boolean },
): Promise<void> {
  if (ip) await increment(db, env, "login_ip", ip, now);
  if (options.trackIdentifier) await increment(db, env, "login_identifier", identifier, now);
}

export async function clearLoginFailures(
  db: Database,
  env: Env,
  identifier: string,
): Promise<void> {
  await db
    .delete(authRateLimitBuckets)
    .where(
      and(
        eq(authRateLimitBuckets.scope, "login_identifier"),
        eq(authRateLimitBuckets.keyHash, keyHash(env, "login_identifier", identifier)),
      ),
    );
}

export async function purgeExpiredAuthRateLimits(db: Database, now: Date): Promise<void> {
  await db.delete(authRateLimitBuckets).where(lt(authRateLimitBuckets.expiresAt, now));
}

export { LIMITS as LOGIN_LIMITS };
