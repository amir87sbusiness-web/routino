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
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.js";
import {
  anonymousCounters,
  discounts,
  entitlements,
  grants,
  otpCodes,
  payments,
  redemptions,
  users,
} from "../db/schema.js";
import { badRequest, notFound } from "../lib/http-errors.js";
import { normalizePhone, toAsciiDigits } from "../lib/phone.js";
import { grantInterval, listGrants, readEntitlement } from "./entitlement.js";
import { hashPassword, validatePassword } from "./password.js";

const DAY_MS = 86_400_000;

export async function adminOverview(db: Database, now: Date) {
  const dayAgo = new Date(now.getTime() - DAY_MS);

  type AggregateRow = {
    total_users: number | string | bigint;
    new_users: number | string | bigint;
    active_subscriptions: number | string | bigint;
    trial_starts: number | string | bigint;
    paid_total: number | string | bigint;
    revenue_toman: number | string | bigint;
    paid_last_24h: number | string | bigint;
    revenue_toman_last_24h: number | string | bigint;
    pending: number | string | bigint;
    verify_failed: number | string | bigint;
    otp_sent_last_24h: number | string | bigint;
  };

  const result = await db.execute(sql`
    with user_stats as (
      select
        count(*) as total_users,
        count(*) filter (
          where ${users.createdAt} > ${dayAgo.toISOString()}::timestamptz
        ) as new_users
      from ${users}
    ), subscription_stats as (
      select count(*) filter (
        where ${entitlements.expiresAt} > ${now.toISOString()}::timestamptz
          and exists (
            select 1 from ${grants}
            where ${grants.userId} = ${entitlements.userId}
              and ${grants.source} <> ${"trial"}
          )
      ) as active_subscriptions
      from ${entitlements}
    ), counter_stats as (
      select coalesce(max(${anonymousCounters.value}) filter (
        where ${anonymousCounters.key} = ${"trial_starts"}
      ), 0) as trial_starts
      from ${anonymousCounters}
    ), payment_stats as (
      select
        count(*) filter (where ${payments.status} = ${"paid"}) as paid_total,
        coalesce(sum(${payments.amountToman}) filter (
          where ${payments.status} = ${"paid"}
        ), 0) as revenue_toman,
        count(*) filter (
          where ${payments.status} = ${"paid"}
            and ${payments.createdAt} > ${dayAgo.toISOString()}::timestamptz
        ) as paid_last_24h,
        coalesce(sum(${payments.amountToman}) filter (
          where ${payments.status} = ${"paid"}
            and ${payments.createdAt} > ${dayAgo.toISOString()}::timestamptz
        ), 0) as revenue_toman_last_24h,
        count(*) filter (where ${payments.status} = ${"redirected"}) as pending,
        count(*) filter (where ${payments.status} = ${"verify_failed"}) as verify_failed
      from ${payments}
    ), otp_stats as (
      select count(*) filter (
        where ${otpCodes.createdAt} > ${dayAgo.toISOString()}::timestamptz
      ) as otp_sent_last_24h
      from ${otpCodes}
    )
    select * from user_stats, subscription_stats, counter_stats, payment_stats, otp_stats
  `);
  const row = rowsOf<AggregateRow>(result)[0];
  const metric = (value: number | string | bigint | undefined) => Number(value ?? 0);

  return {
    users: { total: metric(row?.total_users), last24h: metric(row?.new_users) },
    trialStarts: metric(row?.trial_starts),
    activeSubscriptions: metric(row?.active_subscriptions),
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
    serverTime: now.toISOString(),
  };
}

/** The panel may identify only accounts with durable or financial history.
 * Registration-only and valid trial-only accounts remain aggregate-only. */
function adminUserIsVisible() {
  return sql<boolean>`
    exists (
      select 1 from ${grants}
       where ${grants.userId} = ${users.id} and ${grants.source} <> ${"trial"}
    )
    or exists (
      select 1 from ${payments} where ${payments.userId} = ${users.id}
    )
    or exists (
      select 1 from ${redemptions} where ${redemptions.userId} = ${users.id}
    )
    or exists (
      select 1 from ${entitlements}
       where ${entitlements.userId} = ${users.id} and ${entitlements.planId} <> ${"trial"}
    )
    or exists (
      select 1 from ${discounts}
       where ${discounts.phone} = ${users.phone}
         and (
           ${discounts.usedCount} > 0
           or exists (
             select 1 from ${payments}
              where ${payments.discountCode} = ${discounts.code}
           )
           or exists (
             select 1 from ${redemptions}
              where ${redemptions.code} = ${discounts.code}
           )
         )
    )
  `;
}

export async function adminListUsers(
  db: Database,
  opts: { q?: string; limit?: number },
  now: Date,
) {
  const n = Math.min(opts.limit || 50, 200);
  const visibleInAdmin = adminUserIsVisible();

  const base = db
    .select({
      id: users.id,
      phone: users.phone,
      createdAt: users.createdAt,
      planId: entitlements.planId,
      expiresAt: entitlements.expiresAt,
    })
    .from(users)
    .leftJoin(entitlements, eq(entitlements.userId, users.id))
    .orderBy(desc(users.createdAt))
    .limit(n);

  // Humans type `0912…`; the canonical stored form is `98912…`. Dropping the
  // leading zero makes the obvious search work.
  let digits = opts.q ? toAsciiDigits(opts.q).replace(/\D/g, "") : "";
  if (digits.startsWith("0")) digits = digits.slice(1);
  const rows = digits
    ? await base.where(and(visibleInAdmin, ilike(users.phone, `%${digits}%`)))
    : await base.where(visibleInAdmin);

  return rows.map((r) => ({ ...r, subscriptionActive: !!r.expiresAt && r.expiresAt > now }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function adminUserDetail(db: Database, id: string, now: Date) {
  if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed user id");
  const visibleInAdmin = adminUserIsVisible();
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), visibleInAdmin))
    .limit(1);
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
      createdAt: user.createdAt,
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
    throw badRequest(
      "weak_password",
      "Password must be 8+ chars with at least one letter and one digit",
    );
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

export async function adminListPayments(db: Database, opts: { status?: string; limit?: number }) {
  const n = Math.min(opts.limit || 50, 200);

  const base = db
    .select({
      id: payments.id,
      phone: users.phone,
      userId: payments.userId,
      planId: payments.planId,
      amountToman: payments.amountToman,
      discountCode: payments.discountCode,
      status: payments.status,
      authority: payments.authority,
      platform: payments.platform,
      refNumber: payments.refNumber,
      createdAt: payments.createdAt,
      paidAt: payments.paidAt,
    })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.userId))
    .orderBy(desc(payments.createdAt))
    .limit(n);

  return opts.status ? base.where(eq(payments.status, opts.status)) : base;
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
    percent: number;
    maxUses?: number | null;
    expiresAt?: number | null;
    phone?: string | null;
  },
) {
  const code = body.code.toUpperCase();
  const [existing] = await db.select().from(discounts).where(eq(discounts.code, code)).limit(1);
  if (existing) throw badRequest("duplicate_code", "Code already exists");

  const [row] = await db
    .insert(discounts)
    .values({
      code,
      percent: body.percent,
      maxUses: body.maxUses ?? null,
      expiresAt: toExpiry(body.expiresAt),
      phone: body.phone || null,
      active: true,
    })
    .returning();
  return { ok: true as const, discount: row };
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
