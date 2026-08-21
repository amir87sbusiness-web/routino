// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
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
import { rowsOf, type Database, type DatabaseExecutor } from "../db/client.ts";
import { entitlements, grants } from "../db/schema.ts";

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

export async function readEntitlement(
  db: DatabaseExecutor,
  userId: string,
  now: Date,
): Promise<Entitlement> {
  const [row] = await db
    .select()
    .from(entitlements)
    .where(eq(entitlements.userId, userId))
    .limit(1);
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
  db: DatabaseExecutor,
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
  const tIso = now.toISOString();

  // ONE statement, deliberately.
  //
  // This used to SELECT the current expiry, add the interval in JS, then UPDATE.
  // Two grants landing at the same moment both read the same "before" and the
  // second write silently discarded the first — a user who paid for two months
  // got one. The `on conflict do update` branch re-reads `entitlements.expires_at`
  // under the row lock, so concurrent grants stack instead of overwriting.
  //
  // Postgres still does the calendar arithmetic: `make_interval` is what makes
  // "1 Year" mean 12 real months and 31 Jan + 1 month mean 28 Feb, where JS's
  // `setMonth` would roll over to 3 March.
  const result = await db.execute(sql`
    with prev as (
      select expires_at from entitlements where user_id = ${userId}
    ), upserted as (
      insert into entitlements (user_id, plan_id, expires_at, updated_at)
      values (
        ${userId}, ${opts.planId},
        ${tIso}::timestamptz + make_interval(months => ${months}, days => ${days}),
        ${tIso}::timestamptz
      )
      on conflict (user_id) do update set
        plan_id = excluded.plan_id,
        updated_at = excluded.updated_at,
        expires_at = greatest(entitlements.expires_at, ${tIso}::timestamptz)
                     + make_interval(months => ${months}, days => ${days})
      returning expires_at
    )
    select (select expires_at from prev) as before,
           (select expires_at from upserted) as after
  `);
  const row = rowsOf<{ before: Date | string | null; after: Date | string }>(result)[0];
  if (row?.after == null) throw new Error("failed to compute expiry");
  const expiresAt = row.after instanceof Date ? row.after : new Date(row.after);
  const before =
    row.before == null ? null : row.before instanceof Date ? row.before : new Date(row.before);

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

export type TrialStartReason = "previous_grant" | "entitlement_exists";

export interface TrialStartResult {
  entitlement: Entitlement;
  started: boolean;
  reason?: TrialStartReason;
}

/**
 * Starts the account's only trial when it has no access history of any kind.
 *
 * The user row exists before every authenticated call and is the stable lock
 * shared by all devices and server instances. Once locked, both the immutable
 * ledger and the materialized answer are checked in the same transaction. This
 * second check deliberately rejects an orphan entitlement too: missing audit
 * history must never become a reason to mint more access.
 */
export async function startTrialOnce(
  db: Database,
  userId: string,
  now: Date,
): Promise<TrialStartResult> {
  return db.transaction(async (tx) => {
    const locked = rowsOf<{ id: string }>(
      await tx.execute(sql`select id from users where id = ${userId} for update`),
    );
    if (!locked.length) throw new Error("trial user no longer exists");

    const [previousGrant] = await tx
      .select({ id: grants.id })
      .from(grants)
      .where(eq(grants.userId, userId))
      .limit(1);
    if (previousGrant) {
      return {
        entitlement: await readEntitlement(tx, userId, now),
        started: false,
        reason: "previous_grant" as const,
      };
    }

    const [materialized] = await tx
      .select({ userId: entitlements.userId })
      .from(entitlements)
      .where(eq(entitlements.userId, userId))
      .limit(1);
    if (materialized) {
      return {
        entitlement: await readEntitlement(tx, userId, now),
        started: false,
        reason: "entitlement_exists" as const,
      };
    }

    const entitlement = await grantInterval(
      tx,
      userId,
      { planId: "trial", days: 7, source: "trial" },
      now,
    );
    return { entitlement, started: true };
  });
}

/**
 * Raises expiry to at least `claimed`, never lowering it and never stacking.
 *
 * This is the shape the legacy-subscription import needs: a user with 30 days
 * left on an old local subscription should end up with 30 days, never a claim
 * stacked onto any entitlement that already exists.
 */
export async function ensureExpiresAt(
  db: Database,
  userId: string,
  opts: { planId: string; claimed: Date; source: GrantSource; note?: string | null },
  now: Date,
): Promise<Entitlement> {
  const tIso = now.toISOString();
  const claimedIso = opts.claimed.toISOString();

  // Same single-statement treatment as `grantInterval`: `greatest()` inside the
  // conflict branch can only ever raise the expiry, so a concurrent grant can
  // never be lowered by an import landing at the same moment.
  const result = await db.execute(sql`
    with prev as (
      select expires_at from entitlements where user_id = ${userId}
    ), upserted as (
      insert into entitlements (user_id, plan_id, expires_at, updated_at)
      values (${userId}, ${opts.planId}, ${claimedIso}::timestamptz, ${tIso}::timestamptz)
      on conflict (user_id) do update set
        plan_id = case
          when entitlements.expires_at < ${claimedIso}::timestamptz then excluded.plan_id
          else entitlements.plan_id
        end,
        updated_at = excluded.updated_at,
        expires_at = greatest(entitlements.expires_at, ${claimedIso}::timestamptz)
      returning expires_at
    )
    select (select expires_at from prev) as before,
           (select expires_at from upserted) as after
  `);
  const row = rowsOf<{ before: Date | string | null; after: Date | string }>(result)[0];
  const before =
    row?.before == null ? null : row.before instanceof Date ? row.before : new Date(row.before);

  if (before && before >= opts.claimed) {
    // Already at least as good — the upsert changed nothing, so record nothing.
    return readEntitlement(db, userId, now);
  }

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
