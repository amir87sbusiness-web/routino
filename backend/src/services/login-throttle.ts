/**
 * Rate limits for password sign-in.
 *
 * Two independent windows over the `login_attempts` failure ledger:
 *  - per identifier: stops someone hammering ONE account (or one username),
 *    however many IPs they rotate through.
 *  - per IP: stops credential-stuffing MANY accounts from one source.
 *
 * Only failures are recorded, and a correct password clears the identifier's
 * recent rows — so a legitimate user is never locked out by their own success.
 * State lives in Postgres, not memory: it must be durable and shared across
 * isolates, exactly like the OTP limiter.
 */
import { and, count, eq, gt, lt } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { loginAttempts } from "../db/schema.js";

/** 15-minute window. Slow hashing already makes each guess expensive; these
 * bound how many guesses are even attemptable. */
const WINDOW_SECONDS = 900;
const LIMITS = {
  perIdentifier: 8,
  perIp: 50,
} as const;

export interface LoginRateVerdict {
  ok: boolean;
  retryAfter?: number;
  reason?: "identifier" | "ip";
}

async function countFailures(
  db: Database,
  column: "identifier" | "ip",
  value: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - WINDOW_SECONDS * 1000);
  const col = column === "identifier" ? loginAttempts.identifier : loginAttempts.ip;
  const [row] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(col, value), gt(loginAttempts.createdAt, since)));
  return row?.n ?? 0;
}

export async function checkLoginRate(
  db: Database,
  ip: string | null,
  identifier: string,
  now: Date,
): Promise<LoginRateVerdict> {
  if ((await countFailures(db, "identifier", identifier, now)) >= LIMITS.perIdentifier) {
    return { ok: false, retryAfter: WINDOW_SECONDS, reason: "identifier" };
  }
  if (ip && (await countFailures(db, "ip", ip, now)) >= LIMITS.perIp) {
    return { ok: false, retryAfter: WINDOW_SECONDS, reason: "ip" };
  }
  return { ok: true };
}

/** Records one failed attempt. Also trims rows older than a day for this
 * identifier, so the ledger stays bounded even where no purge job runs (the
 * edge function has no background timer). */
export async function recordLoginFailure(
  db: Database,
  ip: string | null,
  identifier: string,
  now: Date,
): Promise<void> {
  await db.insert(loginAttempts).values({ ip, identifier, createdAt: now });
  await db
    .delete(loginAttempts)
    .where(
      and(
        eq(loginAttempts.identifier, identifier),
        lt(loginAttempts.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
}

/** Clears an identifier's recent failures — called on a successful sign-in so
 * the counter resets the moment the real owner gets in. */
export async function clearLoginFailures(db: Database, identifier: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.identifier, identifier));
}

/** Housekeeping for the Node deployment's purge timer. */
export async function purgeOldLoginAttempts(db: Database, now: Date): Promise<void> {
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(now.getTime() - 86_400_000)));
}

export { LIMITS as LOGIN_LIMITS };
