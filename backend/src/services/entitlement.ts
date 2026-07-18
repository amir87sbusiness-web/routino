/**
 * Entitlement — who may use the app, and until when.
 *
 * Two tables, deliberately:
 *  - `grants` is an append-only ledger of every extension, its source, and the
 *    before/after expiry. Nothing ever updates it.
 *  - `entitlements` is the materialized current answer, and THIS MODULE IS ITS
 *    ONLY WRITER.
 *
 * The ledger exists because "I paid and I don't have access" is inevitable, and
 * a row saying `source=payment, payment_id=…, 2026-07-15 → 2026-10-15` answers
 * it instantly.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.js";
import { entitlements, grants } from "../db/schema.js";

export interface Entitlement {
  status: "active" | "expired" | "none";
  planId: string | null;
  expiresAt: string | null;
  /** Server clock, so the client can detect a skewed device without trusting it. */
  issuedAt: string;
}

/** Sources that mean "this account has already been settled" — either the user
 * paid, or they already imported their legacy subscription once. */
const SETTLED_SOURCES = ["payment", "migration"] as const;

export type GrantSource = "trial" | "payment" | "migration" | "admin";

export async function readEntitlement(db: Database, userId: string, now: Date): Promise<Entitlement> {
  const [row] = await db.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
  if (!row) return { status: "none", planId: null, expiresAt: null, issuedAt: now.toISOString() };
  return {
    status: row.expiresAt > now ? "active" : "expired",
    planId: row.planId,
    expiresAt: row.expiresAt.toISOString(),
    issuedAt: now.toISOString(),
  };
}

/**
 * Extends entitlement by a real calendar interval and records the grant.
 *
 * Renewal stacks onto an unexpired plan (`greatest(now, current)`) so paying
 * early never burns the remaining days. Uses `make_interval`, i.e. real calendar
 * months: "1 Year" is 12 months, not the 360 days the old flat-30-day client
 * arithmetic delivered.
 */
export async function grantInterval(
  db: Database,
  userId: string,
  opts: {
    planId: string;
    months?: number;
    days?: number;
    source: GrantSource;
    paymentId?: string | null;
    note?: string | null;
  },
  now: Date,
): Promise<Entitlement> {
  const months = opts.months ?? 0;
  const days = opts.days ?? 0;

  const [current] = await db.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
  const before = current?.expiresAt ?? null;

  const base = before && before > now ? before : now;

  // Postgres does the calendar arithmetic. `make_interval` is what makes "1
  // Year" mean 12 real months and 31 Jan + 1 month mean 28 Feb — JS's
  // `setMonth` would roll that over to 3 March, and the old client's flat
  // 30-day months delivered a 360-day "year".
  const result = await db.execute(
    sql`select (${base.toISOString()}::timestamptz
        + make_interval(months => ${months}, days => ${days})) as next`,
  );
  const next = rowsOf<{ next: Date | string }>(result)[0]?.next;
  if (next == null) throw new Error("failed to compute expiry");
  const expiresAt = next instanceof Date ? next : new Date(next);

  await db
    .insert(entitlements)
    .values({ userId, planId: opts.planId, expiresAt, updatedAt: now })
    .onConflictDoUpdate({
      target: entitlements.userId,
      set: { planId: opts.planId, expiresAt, updatedAt: now },
    });

  await db.insert(grants).values({
    userId,
    months,
    days,
    source: opts.source,
    paymentId: opts.paymentId ?? null,
    note: opts.note ?? null,
    expiresBefore: before,
    expiresAfter: expiresAt,
    createdAt: now,
  });

  return readEntitlement(db, userId, now);
}

/**
 * Raises expiry to at least `claimed`, never lowering it and never stacking.
 *
 * This is the shape the legacy-subscription import needs: a user with 30 days
 * left on their old local subscription should end up with 30 days, not 30 days
 * plus the 7-day trial they were just given.
 */
export async function ensureExpiresAt(
  db: Database,
  userId: string,
  opts: { planId: string; claimed: Date; source: GrantSource; note?: string | null },
  now: Date,
): Promise<Entitlement> {
  const [current] = await db.select().from(entitlements).where(eq(entitlements.userId, userId)).limit(1);
  const before = current?.expiresAt ?? null;

  if (before && before >= opts.claimed) {
    // Already at least as good — record nothing, change nothing.
    return readEntitlement(db, userId, now);
  }

  await db
    .insert(entitlements)
    .values({ userId, planId: opts.planId, expiresAt: opts.claimed, updatedAt: now })
    .onConflictDoUpdate({
      target: entitlements.userId,
      set: { planId: opts.planId, expiresAt: opts.claimed, updatedAt: now },
    });

  await db.insert(grants).values({
    userId,
    months: 0,
    days: 0,
    source: opts.source,
    note: opts.note ?? null,
    expiresBefore: before,
    expiresAfter: opts.claimed,
    createdAt: now,
  });

  return readEntitlement(db, userId, now);
}

/** True once the account has either paid or already imported a legacy plan.
 * Guards the import endpoint against being replayed for free time. */
export async function hasSettledGrant(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: grants.id })
    .from(grants)
    .where(and(eq(grants.userId, userId), inArray(grants.source, [...SETTLED_SOURCES])))
    .limit(1);
  return !!row;
}

export async function listGrants(db: Database, userId: string) {
  return db.select().from(grants).where(eq(grants.userId, userId)).orderBy(desc(grants.createdAt));
}
