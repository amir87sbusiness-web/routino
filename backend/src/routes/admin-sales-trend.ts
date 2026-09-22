import { sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.js";

const DAY_MS = 86_400_000;
const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;
const MAX_CUSTOM_DAYS = 730;

export type AdminDashboardRange =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "custom";

export type AdminDashboardQuery = {
  range?: string;
  customStart?: string;
  customEnd?: string;
};

type Period = {
  range: AdminDashboardRange;
  start: Date;
  end: Date;
  groupBy: "hour" | "day";
};

const metric = (value: number | string | bigint | null | undefined) => Number(value ?? 0);

function iranMidnightUtc(now: Date, offsetDays = 0): Date {
  const iranNow = new Date(now.getTime() + IRAN_OFFSET_MS);
  const midnightViewedAsUtc = Date.UTC(
    iranNow.getUTCFullYear(),
    iranNow.getUTCMonth(),
    iranNow.getUTCDate() + offsetDays,
    0,
    0,
    0,
    0,
  );
  return new Date(midnightViewedAsUtc - IRAN_OFFSET_MS);
}

function parseIranCalendarDay(value: string | undefined, nextDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const viewedAsUtc = Date.UTC(year, month - 1, day + (nextDay ? 1 : 0), 0, 0, 0, 0);
  const date = new Date(viewedAsUtc - IRAN_OFFSET_MS);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeRange(value: string | undefined): AdminDashboardRange {
  if (
    value === "today" ||
    value === "yesterday" ||
    value === "week" ||
    value === "month" ||
    value === "quarter" ||
    value === "year" ||
    value === "custom"
  ) {
    return value;
  }
  return "month";
}

function resolvePeriod(now: Date, input: AdminDashboardQuery | number): Period {
  // Backward compatibility for the old 7/30/90-day dashboard caller.
  if (typeof input === "number") {
    const range: AdminDashboardRange = input <= 7 ? "week" : input <= 30 ? "month" : input <= 90 ? "quarter" : "year";
    input = { range };
  }

  let range = normalizeRange(input.range);
  const todayStart = iranMidnightUtc(now, 0);
  const tomorrowStart = iranMidnightUtc(now, 1);
  let start = todayStart;
  let end = tomorrowStart;

  if (range === "yesterday") {
    start = iranMidnightUtc(now, -1);
    end = todayStart;
  } else if (range === "week") {
    start = iranMidnightUtc(now, -6);
  } else if (range === "month") {
    start = iranMidnightUtc(now, -29);
  } else if (range === "quarter") {
    start = iranMidnightUtc(now, -89);
  } else if (range === "year") {
    start = iranMidnightUtc(now, -364);
  } else if (range === "custom") {
    const customStart = parseIranCalendarDay(input.customStart);
    const customEnd = parseIranCalendarDay(input.customEnd, true);
    if (!customStart || !customEnd || customEnd <= customStart) {
      range = "month";
      start = iranMidnightUtc(now, -29);
      end = tomorrowStart;
    } else {
      start = customStart;
      end = customEnd;
      const maxEnd = new Date(start.getTime() + MAX_CUSTOM_DAYS * DAY_MS);
      if (end > maxEnd) end = maxEnd;
    }
  }

  return {
    range,
    start,
    end,
    groupBy: end.getTime() - start.getTime() <= DAY_MS ? "hour" : "day",
  };
}

function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function adminSalesTrend(
  db: Database,
  now: Date,
  input: AdminDashboardQuery | number = { range: "month" },
) {
  const period = resolvePeriod(now, input);
  const durationMs = period.end.getTime() - period.start.getTime();
  const previousStart = new Date(period.start.getTime() - durationMs);
  const previousEnd = period.start;

  type MetricRow = {
    current_revenue: number | string | bigint;
    current_purchases: number | string | bigint;
    current_new_purchases: number | string | bigint;
    current_renewals: number | string | bigint;
    current_unique_buyers: number | string | bigint;
    current_new_users: number | string | bigint;
    current_converted_users: number | string | bigint;
    previous_revenue: number | string | bigint;
    previous_purchases: number | string | bigint;
    previous_new_users: number | string | bigint;
    previous_converted_users: number | string | bigint;
    active_subscriptions: number | string | bigint;
    active_trials: number | string | bigint;
    expired_users: number | string | bigint;
    pending_payments: number | string | bigint;
    all_users: number | string | bigint;
    all_revenue: number | string | bigint;
    all_purchases: number | string | bigint;
  };

  const metricsResult = await db.execute(sql`
    with paid_ranked as (
      select
        p.id,
        p.user_id,
        p.amount_toman,
        coalesce(p.applied_at, p.created_at) as paid_at,
        row_number() over (
          partition by coalesce(p.user_id::text, 'payment:' || p.id::text)
          order by coalesce(p.applied_at, p.created_at), p.created_at, p.id
        ) as purchase_number
      from payments p
      where p.status = 'paid'
    ), current_paid as (
      select
        count(*) as purchases,
        coalesce(sum(amount_toman), 0) as revenue,
        count(*) filter (where purchase_number = 1) as new_purchases,
        count(*) filter (where purchase_number > 1) as renewals,
        count(distinct user_id) filter (where user_id is not null) as unique_buyers
      from paid_ranked
      where paid_at >= ${period.start.toISOString()}::timestamptz
        and paid_at < ${period.end.toISOString()}::timestamptz
    ), previous_paid as (
      select
        count(*) as purchases,
        coalesce(sum(amount_toman), 0) as revenue
      from paid_ranked
      where paid_at >= ${previousStart.toISOString()}::timestamptz
        and paid_at < ${previousEnd.toISOString()}::timestamptz
    ), current_users as (
      select
        count(*) as new_users,
        count(*) filter (
          where exists (
            select 1
            from paid_ranked p
            where p.user_id = u.id
              and p.paid_at < ${period.end.toISOString()}::timestamptz
          )
        ) as converted_users
      from users u
      where u.created_at >= ${period.start.toISOString()}::timestamptz
        and u.created_at < ${period.end.toISOString()}::timestamptz
    ), previous_users as (
      select
        count(*) as new_users,
        count(*) filter (
          where exists (
            select 1
            from paid_ranked p
            where p.user_id = u.id
              and p.paid_at < ${previousEnd.toISOString()}::timestamptz
          )
        ) as converted_users
      from users u
      where u.created_at >= ${previousStart.toISOString()}::timestamptz
        and u.created_at < ${previousEnd.toISOString()}::timestamptz
    ), entitlement_stats as (
      select
        count(*) filter (
          where e.expires_at > ${now.toISOString()}::timestamptz
            and exists (
              select 1 from grants g
              where g.user_id = e.user_id and g.source <> 'trial'
            )
        ) as active_subscriptions,
        count(*) filter (
          where e.plan_id = 'trial'
            and e.expires_at > ${now.toISOString()}::timestamptz
        ) as active_trials,
        count(*) filter (
          where e.expires_at <= ${now.toISOString()}::timestamptz
        ) as expired_users
      from entitlements e
    ), pending_stats as (
      select count(*) as pending_payments
      from payments
      where status in ('pending','requesting','redirected','provider_unknown','verifying')
    ), all_time as (
      select
        (select count(*) from users) as all_users,
        count(*) as all_purchases,
        coalesce(sum(amount_toman), 0) as all_revenue
      from payments
      where status = 'paid'
    )
    select
      cp.revenue as current_revenue,
      cp.purchases as current_purchases,
      cp.new_purchases as current_new_purchases,
      cp.renewals as current_renewals,
      cp.unique_buyers as current_unique_buyers,
      cu.new_users as current_new_users,
      cu.converted_users as current_converted_users,
      pp.revenue as previous_revenue,
      pp.purchases as previous_purchases,
      pu.new_users as previous_new_users,
      pu.converted_users as previous_converted_users,
      es.active_subscriptions,
      es.active_trials,
      es.expired_users,
      ps.pending_payments,
      a.all_users,
      a.all_revenue,
      a.all_purchases
    from current_paid cp, previous_paid pp, current_users cu, previous_users pu,
         entitlement_stats es, pending_stats ps, all_time a
  `);

  const m = rowsOf<MetricRow>(metricsResult)[0];
  const currentRevenue = metric(m?.current_revenue);
  const currentPurchases = metric(m?.current_purchases);
  const currentNewUsers = metric(m?.current_new_users);
  const currentConvertedUsers = metric(m?.current_converted_users);
  const previousRevenue = metric(m?.previous_revenue);
  const previousPurchases = metric(m?.previous_purchases);
  const previousNewUsers = metric(m?.previous_new_users);
  const previousConvertedUsers = metric(m?.previous_converted_users);
  const conversionRate = currentNewUsers > 0 ? (currentConvertedUsers / currentNewUsers) * 100 : 0;
  const previousConversionRate = previousNewUsers > 0 ? (previousConvertedUsers / previousNewUsers) * 100 : 0;

  type TrendRow = {
    bucket: string;
    revenue: number | string | bigint;
    purchases: number | string | bigint;
    new_purchases: number | string | bigint;
    renewals: number | string | bigint;
  };

  const trendResult = period.groupBy === "hour"
    ? await db.execute(sql`
        with paid_ranked as (
          select
            p.id,
            p.amount_toman,
            coalesce(p.applied_at, p.created_at) as paid_at,
            row_number() over (
              partition by coalesce(p.user_id::text, 'payment:' || p.id::text)
              order by coalesce(p.applied_at, p.created_at), p.created_at, p.id
            ) as purchase_number
          from payments p
          where p.status = 'paid'
        ), calendar as (
          select generate_series(
            date_trunc('hour', ${period.start.toISOString()}::timestamptz at time zone 'Asia/Tehran'),
            date_trunc('hour', (${period.end.toISOString()}::timestamptz - interval '1 millisecond') at time zone 'Asia/Tehran'),
            interval '1 hour'
          ) as bucket
        )
        select
          to_char(c.bucket, 'YYYY-MM-DD"T"HH24') as bucket,
          coalesce(sum(p.amount_toman), 0) as revenue,
          count(p.id) as purchases,
          count(p.id) filter (where p.purchase_number = 1) as new_purchases,
          count(p.id) filter (where p.purchase_number > 1) as renewals
        from calendar c
        left join paid_ranked p
          on date_trunc('hour', p.paid_at at time zone 'Asia/Tehran') = c.bucket
         and p.paid_at >= ${period.start.toISOString()}::timestamptz
         and p.paid_at < ${period.end.toISOString()}::timestamptz
        group by c.bucket
        order by c.bucket asc
      `)
    : await db.execute(sql`
        with paid_ranked as (
          select
            p.id,
            p.amount_toman,
            coalesce(p.applied_at, p.created_at) as paid_at,
            row_number() over (
              partition by coalesce(p.user_id::text, 'payment:' || p.id::text)
              order by coalesce(p.applied_at, p.created_at), p.created_at, p.id
            ) as purchase_number
          from payments p
          where p.status = 'paid'
        ), calendar as (
          select generate_series(
            (${period.start.toISOString()}::timestamptz at time zone 'Asia/Tehran')::date,
            ((${period.end.toISOString()}::timestamptz - interval '1 millisecond') at time zone 'Asia/Tehran')::date,
            interval '1 day'
          )::date as bucket
        )
        select
          to_char(c.bucket, 'YYYY-MM-DD') as bucket,
          coalesce(sum(p.amount_toman), 0) as revenue,
          count(p.id) as purchases,
          count(p.id) filter (where p.purchase_number = 1) as new_purchases,
          count(p.id) filter (where p.purchase_number > 1) as renewals
        from calendar c
        left join paid_ranked p
          on (p.paid_at at time zone 'Asia/Tehran')::date = c.bucket
         and p.paid_at >= ${period.start.toISOString()}::timestamptz
         and p.paid_at < ${period.end.toISOString()}::timestamptz
        group by c.bucket
        order by c.bucket asc
      `);

  const points = rowsOf<TrendRow>(trendResult).map((row) => ({
    date: row.bucket,
    revenue: metric(row.revenue),
    purchases: metric(row.purchases),
    newPurchases: metric(row.new_purchases),
    renewals: metric(row.renewals),
  }));

  type PlanRow = {
    plan_id: string;
    name_fa: string | null;
    purchases: number | string | bigint;
    revenue: number | string | bigint;
  };
  const planResult = await db.execute(sql`
    select
      p.plan_id,
      max(pl.name_fa) as name_fa,
      count(*) as purchases,
      coalesce(sum(p.amount_toman), 0) as revenue
    from payments p
    left join plans pl on pl.id = p.plan_id
    where p.status = 'paid'
      and coalesce(p.applied_at, p.created_at) >= ${period.start.toISOString()}::timestamptz
      and coalesce(p.applied_at, p.created_at) < ${period.end.toISOString()}::timestamptz
    group by p.plan_id
    order by revenue desc, purchases desc, p.plan_id asc
  `);
  const plans = rowsOf<PlanRow>(planResult).map((row) => ({
    id: row.plan_id,
    name: row.name_fa || row.plan_id,
    purchases: metric(row.purchases),
    revenue: metric(row.revenue),
  }));

  type RecentRow = {
    id: string;
    user_id: string | null;
    phone: string | null;
    username: string | null;
    plan_id: string;
    plan_name: string | null;
    amount_toman: number | string | bigint;
    paid_at: Date | string;
    discount_code: string | null;
    platform: string | null;
    ref_number: string | null;
  };
  const recentResult = await db.execute(sql`
    select
      p.id,
      p.user_id,
      u.phone,
      u.username,
      p.plan_id,
      pl.name_fa as plan_name,
      p.amount_toman,
      coalesce(p.applied_at, p.created_at) as paid_at,
      p.discount_code,
      p.platform,
      p.ref_number
    from payments p
    left join users u on u.id = p.user_id
    left join plans pl on pl.id = p.plan_id
    where p.status = 'paid'
      and coalesce(p.applied_at, p.created_at) >= ${period.start.toISOString()}::timestamptz
      and coalesce(p.applied_at, p.created_at) < ${period.end.toISOString()}::timestamptz
    order by coalesce(p.applied_at, p.created_at) desc, p.id desc
    limit 12
  `);
  const recentPurchases = rowsOf<RecentRow>(recentResult).map((row) => ({
    id: row.id,
    userId: row.user_id,
    phone: row.phone,
    username: row.username,
    planId: row.plan_id,
    planName: row.plan_name || row.plan_id,
    amountToman: metric(row.amount_toman),
    paidAt: row.paid_at instanceof Date ? row.paid_at.toISOString() : String(row.paid_at),
    discountCode: row.discount_code,
    platform: row.platform,
    refNumber: row.ref_number,
  }));

  const topMetrics = {
    revenue: currentRevenue,
    purchases: currentPurchases,
    newUsers: currentNewUsers,
    conversionRate: Math.round(conversionRate * 10) / 10,
  };
  const previousMetrics = {
    revenue: previousRevenue,
    purchases: previousPurchases,
    newUsers: previousNewUsers,
    conversionRate: Math.round(previousConversionRate * 10) / 10,
  };

  return {
    range: period.range,
    groupBy: period.groupBy,
    start: period.start.toISOString(),
    end: period.end.toISOString(),
    serverTime: now.toISOString(),
    topMetrics,
    previousMetrics,
    deltas: {
      revenue: deltaPercent(topMetrics.revenue, previousMetrics.revenue),
      purchases: deltaPercent(topMetrics.purchases, previousMetrics.purchases),
      newUsers: deltaPercent(topMetrics.newUsers, previousMetrics.newUsers),
      conversionRate: deltaPercent(topMetrics.conversionRate, previousMetrics.conversionRate),
    },
    status: {
      activeSubscriptions: metric(m?.active_subscriptions),
      activeTrials: metric(m?.active_trials),
      expiredUsers: metric(m?.expired_users),
      pendingPayments: metric(m?.pending_payments),
    },
    purchaseMix: {
      newPurchases: metric(m?.current_new_purchases),
      renewals: metric(m?.current_renewals),
      uniqueBuyers: metric(m?.current_unique_buyers),
    },
    allTime: {
      users: metric(m?.all_users),
      revenue: metric(m?.all_revenue),
      purchases: metric(m?.all_purchases),
    },
    points,
    // Legacy fields retained so an older cached admin page still renders after API deployment.
    days: Math.max(1, Math.round(durationMs / DAY_MS)),
    totals: {
      newPurchases: metric(m?.current_new_purchases),
      renewals: metric(m?.current_renewals),
    },
    plans,
    recentPurchases,
  };
}
