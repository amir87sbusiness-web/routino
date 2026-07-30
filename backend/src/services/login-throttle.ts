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
  /**
   * Past this many recent failures a WRONG password is refused outright — but a
   * CORRECT one still gets in. That asymmetry is the point: a flat lockout let
   * anyone who knew a customer's phone number keep the real owner out of
   * password sign-in indefinitely with eight wrong guesses every 15 minutes.
   */
  perIdentifierSoft: 8,
  /** Past this many, nothing gets through at all. Each attempt costs one
   * deliberately-slow scrypt, so sustained hammering has to stop being free. */
  perIdentifierHard: 50,
  perIp: 50,
} as const;

export interface LoginRateVerdict {
  ok: boolean;
  /** Over the soft limit: verify the credentials, but reject anything wrong with
   * 429 instead of the usual 401. */
  verifyOnly?: boolean;
  retryAfter?: number;
  reason?: "identifier" | "ip";
}

/** Namespaced key for the admin token, which has no user row to hang a counter
 * off. The prefix keeps it from ever colliding with a sign-in identifier. */
export const adminAttemptKey = (ip: string | null): string => `admin:${ip ?? "unknown"}`;
/** Deliberately tighter than sign-in: there is exactly one correct admin token
 * and the owner types it once. */
const ADMIN_LIMIT = 10;

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
  const failures = await countFailures(db, "identifier", identifier, now);
  if (failures >= LIMITS.perIdentifierHard) {
    return { ok: false, retryAfter: WINDOW_SECONDS, reason: "identifier" };
  }
  if (ip && (await countFailures(db, "ip", ip, now)) >= LIMITS.perIp) {
    return { ok: false, retryAfter: WINDOW_SECONDS, reason: "ip" };
  }
  if (failures >= LIMITS.perIdentifierSoft) {
    return { ok: true, verifyOnly: true, retryAfter: WINDOW_SECONDS, reason: "identifier" };
  }
  return { ok: true };
}

/** Admin-token attempts, over the same ledger. DB-backed rather than in-memory
 * because production runs on serverless isolates, where a `Map` counter resets
 * on every cold start and protects nothing. */
export async function checkAdminRate(
  db: Database,
  ip: string | null,
  now: Date,
): Promise<LoginRateVerdict> {
  const n = await countFailures(db, "identifier", adminAttemptKey(ip), now);
  return n >= ADMIN_LIMIT ? { ok: false, retryAfter: WINDOW_SECONDS } : { ok: true };
}

export async function recordAdminFailure(db: Database, ip: string | null, now: Date): Promise<void> {
  await recordLoginFailure(db, ip, adminAttemptKey(ip), now);
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
  // Identifiers that failed once and never came back — including one
  // `admin:<ip>` key per attacker IP — are swept by the hourly
  // `routino-login-attempts-purge` pg_cron job in supabase/setup.sql, since the
  // edge function has no resident process to run `purgeOldLoginAttempts` on.
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
