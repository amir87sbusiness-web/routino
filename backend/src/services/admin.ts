/**
 * Admin read/write queries — framework-free and shared verbatim with the edge
 * function (so the Fastify route and the Hono route can never drift, and both
 * get the same optimisations). The route adapters only do auth + zod parsing.
 *
 * Performance: the dashboard overview is one aggregate SQL statement. This is
 * one pool checkout and one network round-trip in production, while each source
 * table is scanned at most once. The per-user detail view still fans out its
 * independent, on-demand history reads.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.js";
import {
  anonymousCounters,
  discounts,
  entitlements,
  grants,
  otpCodes,
  payments,
  plans,
  users,
} from "../db/schema.js";
import { badRequest, conflict, notFound } from "../lib/http-errors.js";
import { normalizePhone, toAsciiDigits } from "../lib/phone.js";
import { grantInterval, listGrants, readEntitlement } from "./entitlement.js";
import { hashPassword, validatePassword } from "./password.js";

const DAY_MS = 86_400_000;
const asDate = (value: Date | string | null | undefined): Date | null =>
  value == null ? null : value instanceof Date ? value : new Date(value);

export async function adminOverview(db: Database, now: Date) {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const nowIso = now.toISOString();

  type DailyPoint = {
    date: string;
    newUsers: number;
    paidPayments: number;
    revenueToman: number;
    otpSent: number;
  };
  type AggregateRow = {
    total_users: number | string | bigint;
    new_users: number | string | bigint;
    active_subscriptions: number | string | bigint;
    active_trials: number | string | bigint;
    expired_users: number | string | bigint;
    trial_starts: number | string | bigint;
    paid_total: number | string | bigint;
    revenue_toman: number | string | bigint;
    paid_last_24h: number | string | bigint;
    revenue_toman_last_24h: number | string | bigint;
    pending: number | string | bigint;
    verify_failed: number | string | bigint;
    otp_sent_last_24h: number | string | bigint;
    daily: unknown;
  };

  // One database round-trip serves the whole dashboard. Users and payments are
  // rolled up by Tehran calendar day in their existing full-table aggregate
  // pass, while OTP history is bounded to the 90 days the UI can display.
  const result = await db.execute(sql`
    with bounds as (
      select
        ${nowIso}::timestamptz as now_at,
        ${dayAgo.toISOString()}::timestamptz as day_ago,
        (${nowIso}::timestamptz at time zone 'Asia/Tehran')::date as today,
        (
          date_trunc('day', ${nowIso}::timestamptz at time zone 'Asia/Tehran')
          at time zone 'Asia/Tehran'
        ) - interval '89 days' as trend_start
    ), user_rollup as (
      select
        (${users.createdAt} at time zone 'Asia/Tehran')::date as day,
        count(*) as user_count,
        count(*) filter (where ${users.createdAt} > b.day_ago) as last_24h_count
      from ${users}
      cross join bounds b
      group by 1
    ), user_stats as (
      select
        coalesce(sum(user_count), 0) as total_users,
        coalesce(sum(last_24h_count), 0) as new_users
      from user_rollup
    ), subscription_stats as (
      select count(*) filter (
        where ${entitlements.expiresAt} > ${nowIso}::timestamptz
          and exists (
            select 1 from ${grants}
            where ${grants.userId} = ${entitlements.userId}
              and ${grants.source} <> ${"trial"}
          )
      ) as active_subscriptions,
      count(*) filter (
        where ${entitlements.planId} = ${"trial"}
          and ${entitlements.expiresAt} > ${nowIso}::timestamptz
      ) as active_trials,
      count(*) filter (
        where ${entitlements.expiresAt} <= ${nowIso}::timestamptz
      ) as expired_users
      from ${entitlements}
    ), counter_stats as (
      select coalesce(max(${anonymousCounters.value}) filter (
        where ${anonymousCounters.key} = ${"trial_starts"}
      ), 0) as trial_starts
      from ${anonymousCounters}
    ), payment_rollup as (
      select
        case
          when ${payments.status} = ${"paid"}
            then (coalesce(${payments.appliedAt}, ${payments.createdAt}) at time zone 'Asia/Tehran')::date
          else null
        end as day,
        count(*) filter (where ${payments.status} = ${"paid"}) as paid_count,
        coalesce(sum(${payments.amountToman}) filter (
          where ${payments.status} = ${"paid"}
        ), 0) as revenue_toman,
        count(*) filter (
          where ${payments.status} = ${"paid"}
            and ${payments.createdAt} > b.day_ago
        ) as paid_last_24h,
        coalesce(sum(${payments.amountToman}) filter (
          where ${payments.status} = ${"paid"}
            and ${payments.createdAt} > b.day_ago
        ), 0) as revenue_toman_last_24h,
        count(*) filter (where ${payments.status} = ${"redirected"}) as pending,
        count(*) filter (where ${payments.status} = ${"verify_failed"}) as verify_failed
      from ${payments}
      cross join bounds b
      group by 1
    ), payment_stats as (
      select
        coalesce(sum(paid_count), 0) as paid_total,
        coalesce(sum(revenue_toman), 0) as revenue_toman,
        coalesce(sum(paid_last_24h), 0) as paid_last_24h,
        coalesce(sum(revenue_toman_last_24h), 0) as revenue_toman_last_24h,
        coalesce(sum(pending), 0) as pending,
        coalesce(sum(verify_failed), 0) as verify_failed
      from payment_rollup
    ), otp_daily as (
      select
        (${otpCodes.createdAt} at time zone 'Asia/Tehran')::date as day,
        count(*) as otp_sent,
        count(*) filter (where ${otpCodes.createdAt} > b.day_ago) as otp_last_24h
      from ${otpCodes}
      cross join bounds b
      where ${otpCodes.createdAt} >= b.trend_start
        and ${otpCodes.createdAt} <= b.now_at
      group by 1
    ), otp_stats as (
      select coalesce(sum(otp_last_24h), 0) as otp_sent_last_24h
      from otp_daily
    ), calendar as (
      select generate_series(
        b.today - 89,
        b.today,
        interval '1 day'
      )::date as day
      from bounds b
    ), daily_stats as (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'date', to_char(c.day, 'YYYY-MM-DD'),
            'newUsers', coalesce(u.user_count, 0),
            'paidPayments', coalesce(p.paid_count, 0),
            'revenueToman', coalesce(p.revenue_toman, 0),
            'otpSent', coalesce(o.otp_sent, 0)
          )
          order by c.day
        ),
        '[]'::jsonb
      ) as daily
      from calendar c
      left join user_rollup u on u.day = c.day
      left join payment_rollup p on p.day = c.day
      left join otp_daily o on o.day = c.day
    )
    select *
    from user_stats, subscription_stats, counter_stats, payment_stats, otp_stats, daily_stats
  `);
  const row = rowsOf<AggregateRow>(result)[0];
  const metric = (value: number | string | bigint | undefined) => Number(value ?? 0);
  const dailyValue = row?.daily;
  let rawDaily: unknown[] = [];
  if (Array.isArray(dailyValue)) {
    rawDaily = dailyValue;
  } else if (typeof dailyValue === "string") {
    try {
      const parsed: unknown = JSON.parse(dailyValue);
      rawDaily = Array.isArray(parsed) ? parsed : [];
    } catch {
      rawDaily = [];
    }
  }
  const daily: DailyPoint[] = rawDaily.map((point: Record<string, unknown>) => ({
    date: String(point.date ?? ""),
    newUsers: metric(point.newUsers as number | string | bigint | undefined),
    paidPayments: metric(point.paidPayments as number | string | bigint | undefined),
    revenueToman: metric(point.revenueToman as number | string | bigint | undefined),
    otpSent: metric(point.otpSent as number | string | bigint | undefined),
  }));

  return {
    users: { total: metric(row?.total_users), last24h: metric(row?.new_users) },
    trialStarts: metric(row?.trial_starts),
    activeSubscriptions: metric(row?.active_subscriptions),
    activeTrials: metric(row?.active_trials),
    expiredUsers: metric(row?.expired_users),
    payments: {
      paidTotal: metric(row?.paid_total),
      revenueToman: metric(row?.revenue_toman),
      paidLast24h: metric(row?.paid_last_24h),
      revenueTomanLast24h: metric(row?.revenue_toman_last_24h),
      pending: metric(row?.pending),
    },
    // verify_failed = amount mismatch; must never happen. Surfaced loudly.
    alerts: { verifyFailed: metric(row?.verify_failed) },
    otpSentLast24h: metric(row?.otp_sent_last_24h),
    daily,
    serverTime: nowIso,
  };
}

export async function adminListUsers(
  db: Database,
  opts: { q?: string; limit?: number },
  now: Date,
) {
  const n = Math.min(opts.limit || 50, 200);

  // Humans type `0912…`; the canonical stored form is `98912…`. Dropping the
  // leading zero makes the obvious search work.
  const query = opts.q?.trim().toLowerCase() ?? "";
  let digits = toAsciiDigits(query).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  const result = await db.execute(sql`
    select u.id, u.phone, u.username, u.created_at,
           u.active_days, u.last_active_at,
           u.sync_record_count, u.sync_data_bytes,
           e.plan_id, e.expires_at
      from users u
      left join entitlements e on e.user_id = u.id
     where ${query === ""}
        or lower(coalesce(u.username, '')) like ${`%${query}%`}
        or (${digits !== ""} and u.phone like ${`%${digits}%`})
     order by u.created_at desc
     limit ${n}
  `);
  type UserSummaryRow = {
    id: string;
    phone: string;
    username: string | null;
    created_at: Date;
    active_days: number | string | bigint;
    last_active_at: Date | null;
    sync_record_count: number | string | bigint;
    sync_data_bytes: number | string | bigint;
    plan_id: string | null;
    expires_at: Date | null;
  };
  return rowsOf<UserSummaryRow>(result).map((row) => ({
    id: row.id,
    phone: row.phone,
    username: row.username,
    createdAt: asDate(row.created_at),
    activeDays: nonnegativeMetric(row.active_days),
    lastActiveAt: asDate(row.last_active_at),
    syncRecordCount: nonnegativeMetric(row.sync_record_count),
    syncDataBytes: nonnegativeMetric(row.sync_data_bytes),
    planId: row.plan_id,
    expiresAt: asDate(row.expires_at),
    subscriptionActive: !!asDate(row.expires_at) && asDate(row.expires_at)! > now,
  }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function adminUserDetail(db: Database, id: string, now: Date) {
  if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed user id");
  const userResult = await db.execute(sql`
    select id, phone, username, created_at, active_days, last_active_at,
           sync_record_count, sync_data_bytes
      from users
     where id = ${id}::uuid
     limit 1
  `);
  const [user] = rowsOf<{
    id: string;
    phone: string;
    username: string | null;
    created_at: Date;
    active_days: number | string | bigint;
    last_active_at: Date | null;
    sync_record_count: number | string | bigint;
    sync_data_bytes: number | string | bigint;
  }>(userResult);
  if (!user) throw notFound("unknown_user", "No such user");

  const [userPayments, userGrants, entitlement] = await Promise.all([
    db.select().from(payments).where(eq(payments.userId, id)).orderBy(desc(payments.createdAt)),
    listGrants(db, id),
    readEntitlement(db, id, now),
  ]);

  return {
    user: {
      id: user.id,
      phone: user.phone,
      username: user.username,
      createdAt: asDate(user.created_at),
      activeDays: nonnegativeMetric(user.active_days),
      lastActiveAt: asDate(user.last_active_at),
      syncRecordCount: nonnegativeMetric(user.sync_record_count),
      syncDataBytes: nonnegativeMetric(user.sync_data_bytes),
    },
    entitlement,
    payments: userPayments,
    grants: userGrants,
  };
}

export async function adminGrant(
  db: Database,
  id: string,
  body: { months: number; days: number; planId: string; note?: string | null },
  now: Date,
) {
  if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed user id");
  if (body.months === 0 && body.days === 0)
    throw badRequest("empty_grant", "months or days required");
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw notFound("unknown_user", "No such user");

  const entitlement = await grantInterval(
    db,
    id,
    {
      planId: body.planId,
      months: body.months,
      days: body.days,
      source: "admin",
      note: body.note ?? null,
    },
    now,
  );
  return { ok: true as const, entitlement };
}

/**
 * Sets (or resets) a user's password by phone number, creating the account if it
 * doesn't exist yet. This is how the owner provisions a password-login account
 * from the panel when SMS isn't live — the panel is deliberately usable exactly
 * when OTP is down. Account creation itself grants no access; entitlement is
 * activated or granted through its own explicit business path.
 */
export async function adminSetPassword(
  db: Database,
  body: { phone: string; password: string },
  now: Date,
) {
  const phone = normalizePhone(body.phone);
  if (!phone) throw badRequest("invalid_phone", "Enter a valid Iranian mobile number");
  if (!validatePassword(body.password).ok) {
    throw badRequest("weak_password", "Password must be 8–128 characters");
  }

  const passwordHash = await hashPassword(body.password);
  let [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  let created = false;
  if (user) {
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
  } else {
    [user] = await db.insert(users).values({ phone, passwordHash, createdAt: now }).returning();
    created = true;
    if (!user) throw new Error("failed to create user");
  }

  return { ok: true as const, created, userId: user.id, phone };
}

const nonnegativeMetric = (value: number | string | bigint | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export async function adminListPlans(db: Database) {
  return db.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.months));
}

export async function adminUpdatePlanPrice(
  db: Database,
  id: string,
  priceToman: number,
  compareAtPriceToman: number | null,
) {
  if (compareAtPriceToman != null && compareAtPriceToman <= priceToman) {
    throw badRequest("invalid_original_price", "Original price must be greater than sale price");
  }
  const [plan] = await db
    .update(plans)
    .set({ priceToman, compareAtPriceToman })
    .where(eq(plans.id, id))
    .returning();
  if (!plan) throw notFound("unknown_plan", "No such plan");
  return { ok: true as const, plan };
}

export type OfferRule = { kind: "percent" | "fixed"; value: number };
export async function adminUpdatePlanOffer(
  db: Database,
  id: string,
  first: OfferRule,
  second: OfferRule,
) {
  const [plan] = await db
    .update(plans)
    .set({
      offerFirstKind: first.kind,
      offerFirstValue: first.value,
      offerSecondKind: second.kind,
      offerSecondValue: second.value,
    })
    .where(eq(plans.id, id))
    .returning();
  if (!plan) throw notFound("unknown_plan", "No such plan");
  return { ok: true as const, plan };
}

export async function adminSetOfferEnabled(db: Database, enabled: boolean) {
  await db.update(plans).set({ offerEnabled: enabled });
  return { ok: true as const, enabled };
}

export async function adminListDiscounts(db: Database) {
  return db.select().from(discounts).orderBy(discounts.code);
}

/** The largest instant a JS `Date` can represent; past this it is Invalid Date. */
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

/**
 * Epoch ms -> Date, clamped.
 *
 * `expiresAt` is validated as `z.number().int().positive()`, which still admits
 * values past the largest representable instant. `new Date()` would then yield
 * Invalid Date and the insert would fail with an opaque 500 instead of setting
 * an expiry. Clamping is lossless in meaning: an absurdly distant expiry and the
 * maximum representable one both say "this code never expires".
 */
const toExpiry = (ms: number | null | undefined): Date | null =>
  ms ? new Date(Math.min(ms, MAX_TIMESTAMP_MS)) : null;

export async function adminCreateDiscount(
  db: Database,
  body: {
    code: string;
    percent?: number;
    planRules?: Record<string, { kind: "percent" | "fixed"; value: number }>;
    maxUses?: number | null;
    expiresAt?: number | null;
    phone?: string | null;
  },
) {
  const code = body.code.toUpperCase();
  const planRules = body.planRules ?? {};
  if (!body.percent && !Object.keys(planRules).length)
    throw badRequest("missing_discount_rule", "Choose at least one plan discount");
  if (Object.keys(planRules).length) {
    const existingPlans = await db
      .select({ id: plans.id })
      .from(plans)
      .where(inArray(plans.id, Object.keys(planRules)));
    if (existingPlans.length !== Object.keys(planRules).length)
      throw badRequest("unknown_discount_plan", "Discount rule references an unknown plan");
  }
  const [existing] = await db.select().from(discounts).where(eq(discounts.code, code)).limit(1);
  if (existing) throw badRequest("duplicate_code", "Code already exists");

  const [row] = await db
    .insert(discounts)
    .values({
      code,
      percent: body.percent ?? 0,
      planRules,
      maxUses: body.maxUses ?? null,
      expiresAt: toExpiry(body.expiresAt),
      phone: body.phone || null,
      active: true,
    })
    .returning();
  return { ok: true as const, discount: row };
}

/** Deletes operational code state but never payment history. In-flight
 * checkouts are blocked so a recreated code cannot alter their accounting. */
export async function adminDeleteDiscount(db: Database, code: string) {
  const normalized = code.toUpperCase();
  const [inFlight] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.discountCode, normalized),
        isNull(payments.appliedAt),
        inArray(payments.status, [
          "pending",
          "requesting",
          "redirected",
          "provider_unknown",
          "verifying",
        ]),
      ),
    )
    .limit(1);
  if (inFlight)
    throw conflict("discount_in_use", "Wait for the in-progress payment before deleting this code");
  const [removed] = await db.delete(discounts).where(eq(discounts.code, normalized)).returning();
  if (!removed) throw notFound("unknown_code", "No such discount");
  return { ok: true as const, code: removed.code };
}

export async function adminUpdateDiscount(
  db: Database,
  code: string,
  body: { active?: boolean; maxUses?: number | null; expiresAt?: number | null },
) {
  const patch: Record<string, unknown> = {};
  if (body.active !== undefined) patch.active = body.active;
  if (body.maxUses !== undefined) patch.maxUses = body.maxUses;
  if (body.expiresAt !== undefined) patch.expiresAt = toExpiry(body.expiresAt);
  if (!Object.keys(patch).length) throw badRequest("empty_patch", "Nothing to update");

  const [row] = await db
    .update(discounts)
    .set(patch)
    .where(eq(discounts.code, code.toUpperCase()))
    .returning();
  if (!row) throw notFound("unknown_code", "No such discount");
  return { ok: true as const, discount: row };
}
