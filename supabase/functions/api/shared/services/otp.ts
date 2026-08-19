// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * One-time codes for phone sign-in.
 *
 * The threat model is your SMS bill, not account takeover. Every send costs real
 * Toman at Kavenegar, so an unthrottled endpoint is a direct invoice — layered
 * limits are load-bearing, not defence in depth.
 *
 * Limit state lives in Postgres rather than memory: it must be durable across
 * restarts, and an in-memory counter silently stops working the day you run two
 * API instances.
 */
// `node:buffer` is imported explicitly (not the Node global) so this file runs
// unchanged on Deno, where the Buffer global does not exist.
import { Buffer } from "node:buffer";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.ts";
import { otpCodes } from "../db/schema.ts";
import type { Env } from "../env.ts";

/** Per-phone and per-IP windows. The per-minute rule is what stops a tight loop;
 * the daily rules bound the worst case. */
const LIMITS = {
  phonePerMinute: 1,
  phonePerHour: 5,
  phonePerDay: 10,
  ipPerHour: 20,
  /** Circuit breaker: a hard global stop so a novel abuse pattern cannot run up
   * an unbounded bill overnight before anyone notices. */
  globalPerDay: 2000,
} as const;

/** 4 digits, from a CSPRNG. `Math.random()` is predictable and would make codes
 * guessable from a few samples. */
export const generateCode = (): string => String(randomInt(1_000, 10_000));

/** Peppered so a database dump alone cannot be brute-forced back to codes — a
 * 4-digit space is exhaustible in milliseconds without one. */
const hashCode = (code: string, env: Env): string =>
  createHash("sha256").update(`${code}${env.OTP_PEPPER}`).digest("hex");

const constantTimeEquals = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

/* Uses the query builder rather than raw SQL: `db.execute()` returns a bare
 * array on node-postgres but a `{ rows }` object on PGlite, whereas `select()`
 * yields a plain array on both. */
async function countSince(
  db: Database,
  column: "phone" | "ip",
  value: string,
  seconds: number,
  now: Date,
) {
  const since = new Date(now.getTime() - seconds * 1000);
  const col = column === "phone" ? otpCodes.phone : otpCodes.ip;
  const [row] = await db
    .select({ n: count() })
    .from(otpCodes)
    .where(and(eq(col, value), gt(otpCodes.createdAt, since)));
  return row?.n ?? 0;
}

/** What `claimSendSlot` hands back: the plaintext code for the provider, plus
 * the row id so a provably-unsent message can give the slot back. */
export interface SendSlot {
  code: string;
  slotId: string;
}

export interface RateVerdict {
  ok: boolean;
  retryAfter?: number;
  reason?: "phone_minute" | "phone_hour" | "phone_day" | "ip_hour" | "global_day";
}

export async function checkSendRate(
  db: Database,
  phone: string,
  ip: string | null,
  now: Date,
): Promise<RateVerdict> {
  if ((await countSince(db, "phone", phone, 60, now)) >= LIMITS.phonePerMinute) {
    return { ok: false, retryAfter: 60, reason: "phone_minute" };
  }
  if ((await countSince(db, "phone", phone, 3600, now)) >= LIMITS.phonePerHour) {
    return { ok: false, retryAfter: 3600, reason: "phone_hour" };
  }
  if ((await countSince(db, "phone", phone, 86400, now)) >= LIMITS.phonePerDay) {
    return { ok: false, retryAfter: 86400, reason: "phone_day" };
  }
  if (ip && (await countSince(db, "ip", ip, 3600, now)) >= LIMITS.ipPerHour) {
    return { ok: false, retryAfter: 3600, reason: "ip_hour" };
  }

  const since = new Date(now.getTime() - 86_400_000);
  const [row] = await db.select({ n: count() }).from(otpCodes).where(gt(otpCodes.createdAt, since));
  if ((row?.n ?? 0) >= LIMITS.globalPerDay) {
    // Deliberately a hard stop. If this ever fires, something is wrong and it
    // should page you rather than quietly keep spending.
    return { ok: false, retryAfter: 3600, reason: "global_day" };
  }

  return { ok: true };
}

/** Creates and stores a code. Returns the plaintext ONCE, for the SMS provider —
 * it is never persisted, logged, or returned to a client.
 *
 * Prefer `claimSendSlot`, which does this and the rate check together. This is
 * exported for the tests that need to write a code without spending a slot. */
export async function createCode(
  db: Database,
  env: Env,
  phone: string,
  ip: string | null,
  now: Date,
): Promise<string> {
  const code = generateCode();
  await db.insert(otpCodes).values({
    phone,
    codeHash: hashCode(code, env),
    expiresAt: new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000),
    ip,
    createdAt: now,
  });
  return code;
}

/**
 * Claims one send slot and writes the code — in a SINGLE statement.
 *
 * `checkSendRate` then `createCode` is read-then-write, and every send costs
 * real money at Kavenegar. Five requests for one phone arriving together each
 * counted zero rows and each sent a message: the per-minute limit of one was
 * whatever the concurrency happened to be. Sequential callers never see it, and
 * neither does a single-connection test database, which is why this is asserted
 * at the service level in `backend/test/concurrency.test.ts`.
 *
 * Two things make it safe, and both are needed:
 *
 *  - `pg_try_advisory_xact_lock` keyed on the phone serialises requests for the
 *    SAME number and nothing else. A conditional INSERT alone would not be
 *    enough: under READ COMMITTED both transactions can evaluate the counts
 *    against their own snapshot before either commits, and both would insert.
 *  - Losing the lock is treated as "rate limited", not as an error. A second
 *    request for the same phone in the same instant is precisely what the limit
 *    exists to refuse.
 *
 * Returns the plaintext code, or null when the caller may not send.
 */
export async function claimSendSlot(
  db: Database,
  env: Env,
  phone: string,
  ip: string | null,
  now: Date,
): Promise<SendSlot | null> {
  const code = generateCode();
  // Converted to an ISO STRING here, in JS, before it ever reaches the SQL
  // template — a `::timestamptz` cast in the SQL text is not enough on its own.
  // node-postgres (the Fastify backend) happily serialises a raw JS `Date`
  // parameter itself; postgres.js — the driver the DEPLOYED edge function runs
  // on Deno — does not, and throws `ERR_INVALID_ARG_TYPE: Received an instance
  // of Date` while trying to encode the parameter, before the query (and its
  // cast) is even sent. The cast only tells Postgres how to interpret a STRING
  // that already arrived; it cannot rescue a value the client driver couldn't
  // serialise in the first place. `grantInterval` in entitlement.ts got this
  // right by calling \`.toISOString()\` up front — this now matches it.
  const atIso = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + env.OTP_TTL_SECONDS * 1000).toISOString();

  const res = await db.execute(sql`
    with lk as (
      select pg_try_advisory_xact_lock(hashtext(${phone})) as got
    ),
    verdict as (
      select lk.got
        and (select count(*) from otp_codes
              where phone = ${phone} and created_at > ${atIso(60)}::timestamptz) < ${LIMITS.phonePerMinute}
        and (select count(*) from otp_codes
              where phone = ${phone} and created_at > ${atIso(3600)}::timestamptz) < ${LIMITS.phonePerHour}
        and (select count(*) from otp_codes
              where phone = ${phone} and created_at > ${atIso(86400)}::timestamptz) < ${LIMITS.phonePerDay}
        and (${ip}::text is null or (select count(*) from otp_codes
              where ip = ${ip} and created_at > ${atIso(3600)}::timestamptz) < ${LIMITS.ipPerHour})
        and (select count(*) from otp_codes
              where created_at > ${atIso(86400)}::timestamptz) < ${LIMITS.globalPerDay}
        as allow
      from lk
    )
    insert into otp_codes (phone, code_hash, expires_at, ip, created_at)
    select ${phone}, ${hashCode(code, env)},
           ${expiresIso}::timestamptz,
           ${ip}, ${nowIso}::timestamptz
      from verdict where verdict.allow
    returning id
  `);

  const [row] = rowsOf<{ id: string }>(res);
  return row ? { code, slotId: row.id } : null;
}

/**
 * Gives back a slot claimed by `claimSendSlot` when the message provably never
 * went out.
 *
 * The rate limit exists to protect the SMS bill, so a send that cost nothing
 * should cost the user nothing either. Without this, a misconfigured template or
 * an empty Kavenegar account burns the caller's per-hour allowance while they
 * receive no code at all — they are locked out for an hour by OUR fault, and the
 * failure looks to them exactly like "the SMS sometimes doesn't arrive".
 *
 * Only ever called for `SmsNotSentError`, never for a timeout or a 5xx: those
 * are ambiguous, the message may really have been sent, and refunding on an
 * ambiguous failure is how a retry loop turns into an unbounded bill.
 */
export async function releaseSendSlot(db: Database, slotId: string): Promise<void> {
  await db.delete(otpCodes).where(eq(otpCodes.id, slotId));
}

export type VerifyResult =
  { ok: true } | { ok: false; reason: "no_code" | "expired" | "too_many" | "wrong" };

/**
 * Verifies and consumes a code.
 *
 * Only the newest unconsumed code counts: requesting a second code must
 * invalidate the first, or an attacker gains one extra guess per request.
 */
export async function verifyCode(
  db: Database,
  env: Env,
  phone: string,
  code: string,
  now: Date,
): Promise<VerifyResult> {
  const [row] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!row) return { ok: false, reason: "no_code" };
  if (row.expiresAt <= now) return { ok: false, reason: "expired" };

  // Claim one attempt ATOMICALLY, before checking the code.
  //
  // Both halves matter. Counting first means a crash mid-verify cannot hand out
  // a free guess. Doing it as a single conditional UPDATE means the cap is
  // enforced by Postgres rather than by a read-then-write in JS: the old
  // `attempts: row.attempts + 1` let N concurrent requests all read the same
  // value and all spend the same slot, turning "3 guesses" into "3 × however
  // many requests you send at once".
  const claimed = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(and(eq(otpCodes.id, row.id), lt(otpCodes.attempts, Math.min(env.OTP_MAX_ATTEMPTS, 3))))
    .returning();
  if (!claimed.length) return { ok: false, reason: "too_many" };

  if (!constantTimeEquals(row.codeHash, hashCode(code, env))) return { ok: false, reason: "wrong" };

  // Single-use: consume on success.
  await db.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, row.id));
  return { ok: true };
}

/** Housekeeping — codes are useless after a day, and they are the rate-limit
 * ledger, so they must outlive the longest window (24h) before being purged.
 *
 * Called on a timer by the Node server. Production is an edge function with no
 * resident process, so there the same DELETE runs hourly as a pg_cron job
 * (`routino-otp-purge`, installed by supabase/setup.sql). If that job is ever
 * missing, this table grows forever and `checkSendRate` reads it five times per
 * code request — verify with:
 *   select jobname, schedule from cron.job;
 */
export async function purgeOldCodes(db: Database, now: Date): Promise<void> {
  await db.delete(otpCodes).where(lt(otpCodes.createdAt, new Date(now.getTime() - 86_400_000)));
}

export { LIMITS };
