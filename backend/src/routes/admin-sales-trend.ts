import { sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.js";

const DAY_MS = 86_400_000;
const MIN_DAYS = 7;
const MAX_DAYS = 90;

const boundedRate = (numerator: number, denominator: number): number =>
  denominator > 0 ? Math.min(100, Math.max(0, (numerator / denominator) * 100)) : 0;

export async function adminSalesTrend(db: Database, now: Date, days = 30) {
  const rangeDays = Number.isFinite(days)
    ? Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.trunc(days)))
    : 30;
  const start = new Date(now.getTime() - (rangeDays - 1) * DAY_MS);
  const nowIso = now.toISOString();

  type TrendRow = {
    day: string;
    new_purchases: number | string | bigint;
    renewals: number | string | bigint;
    early_repeats: number | string | bigint;
    new_users: number | string | bigint;
    same_day_buyers: number | string | bigint;
    eligible_expirations: number | string | bigint;
    renewed_expirations: number | string | bigint;
  };

  const result = await db.execute(sql`
    with bounds as (
      select
        ${nowIso}::timestamptz as now_at,
        (${start.toISOString()}::timestamptz at time zone 'Asia/Tehran')::date as start_day,
        (${nowIso}::timestamptz at time zone 'Asia/Tehran')::date as end_day
    ), qualifying_paid as (
      select
        p.id,
        p.user_id,
        p.applied_at as paid_at,
        row_number() over (
          partition by p.user_id
          order by p.applied_at, p.created_at, p.id
        ) as purchase_number
      from payments p
      where p.status = 'paid'
        and p.user_id is not null
        and p.amount_toman > 0
        and p.applied_at is not null
    ), first_paid as (
      select user_id, min(paid_at) as first_paid_at
      from qualifying_paid
      group by user_id
    ), user_daily as (
      select
        (u.created_at at time zone 'Asia/Tehran')::date as day,
        count(*) as new_users,
        count(*) filter (
          where f.first_paid_at is not null
            and (f.first_paid_at at time zone 'Asia/Tehran')::date =
                (u.created_at at time zone 'Asia/Tehran')::date
        ) as same_day_buyers
      from users u
      left join first_paid f on f.user_id = u.id
      cross join bounds b
      where (u.created_at at time zone 'Asia/Tehran')::date between b.start_day and b.end_day
      group by 1
    ), payment_events as (
      select
        q.id,
        q.user_id,
        q.paid_at,
        q.purchase_number,
        (
          q.purchase_number > 1
          and g.id is not null
          and g.expires_before is not null
          and g.expires_before <= g.created_at
        ) as is_true_renewal
      from qualifying_paid q
      left join grants g
        on g.payment_id = q.id
       and g.source = 'payment'
    ), purchase_daily as (
      select
        (p.paid_at at time zone 'Asia/Tehran')::date as day,
        count(*) filter (where p.purchase_number = 1) as new_purchases,
        count(*) filter (where p.is_true_renewal) as renewals,
        count(*) filter (
          where p.purchase_number > 1
            and not p.is_true_renewal
        ) as early_repeats
      from payment_events p
      cross join bounds b
      where (p.paid_at at time zone 'Asia/Tehran')::date between b.start_day and b.end_day
      group by 1
    ), grant_sequence as (
      select
        g.id,
        g.user_id,
        g.source,
        g.payment_id,
        g.created_at,
        g.expires_after,
        lead(g.created_at) over (
          partition by g.user_id
          order by g.created_at, g.id
        ) as next_grant_at,
        lead(g.source) over (
          partition by g.user_id
          order by g.created_at, g.id
        ) as next_grant_source,
        lead(g.payment_id) over (
          partition by g.user_id
          order by g.created_at, g.id
        ) as next_payment_id
      from grants g
    ), expiry_events as (
      select
        g.user_id,
        g.expires_after as expired_at,
        g.next_grant_at,
        g.next_grant_source,
        g.next_payment_id
      from grant_sequence g
      cross join bounds b
      where g.expires_after is not null
        and g.expires_after <= b.now_at
        and (g.next_grant_at is null or g.next_grant_at > g.expires_after)
        and exists (
          select 1
          from qualifying_paid prior
          where prior.user_id = g.user_id
            and prior.paid_at <= g.created_at
        )
    ), expiry_daily as (
      select
        (e.expired_at at time zone 'Asia/Tehran')::date as day,
        count(*) as eligible_expirations,
        count(*) filter (
          where e.next_grant_source = 'payment'
            and e.next_grant_at > e.expired_at
            and exists (
              select 1
              from qualifying_paid next_paid
              where next_paid.id = e.next_payment_id
            )
        ) as renewed_expirations
      from expiry_events e
      cross join bounds b
      where (e.expired_at at time zone 'Asia/Tehran')::date between b.start_day and b.end_day
      group by 1
    ), calendar as (
      select generate_series(
        b.start_day,
        b.end_day,
        interval '1 day'
      )::date as day
      from bounds b
    )
    select
      to_char(c.day, 'YYYY-MM-DD') as day,
      coalesce(p.new_purchases, 0) as new_purchases,
      coalesce(p.renewals, 0) as renewals,
      coalesce(p.early_repeats, 0) as early_repeats,
      coalesce(u.new_users, 0) as new_users,
      coalesce(u.same_day_buyers, 0) as same_day_buyers,
      coalesce(e.eligible_expirations, 0) as eligible_expirations,
      coalesce(e.renewed_expirations, 0) as renewed_expirations
    from calendar c
    left join purchase_daily p on p.day = c.day
    left join user_daily u on u.day = c.day
    left join expiry_daily e on e.day = c.day
    order by c.day asc
  `);

  const metric = (value: number | string | bigint | null | undefined) => Number(value ?? 0);
  const points = rowsOf<TrendRow>(result).map((row) => {
    const newUsers = metric(row.new_users);
    const sameDayBuyers = metric(row.same_day_buyers);
    const eligibleExpirations = metric(row.eligible_expirations);
    const renewedExpirations = metric(row.renewed_expirations);
    return {
      date: row.day,
      newPurchases: metric(row.new_purchases),
      renewals: metric(row.renewals),
      earlyRepeats: metric(row.early_repeats),
      newUsers,
      sameDayBuyers,
      conversionRate: boundedRate(sameDayBuyers, newUsers),
      eligibleExpirations,
      renewedExpirations,
      renewalRate: boundedRate(renewedExpirations, eligibleExpirations),
    };
  });

  const totals = points.reduce(
    (acc, point) => {
      acc.newPurchases += point.newPurchases;
      acc.renewals += point.renewals;
      acc.earlyRepeats += point.earlyRepeats;
      acc.newUsers += point.newUsers;
      acc.sameDayBuyers += point.sameDayBuyers;
      acc.eligibleExpirations += point.eligibleExpirations;
      acc.renewedExpirations += point.renewedExpirations;
      return acc;
    },
    {
      newPurchases: 0,
      renewals: 0,
      earlyRepeats: 0,
      newUsers: 0,
      sameDayBuyers: 0,
      eligibleExpirations: 0,
      renewedExpirations: 0,
    },
  );

  return {
    days: rangeDays,
    points,
    totals: {
      ...totals,
      conversionRate: boundedRate(totals.sameDayBuyers, totals.newUsers),
      renewalRate: boundedRate(totals.renewedExpirations, totals.eligibleExpirations),
    },
  };
}
