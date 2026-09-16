import { sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.js";

const DAY_MS = 86_400_000;
const MIN_DAYS = 7;
const MAX_DAYS = 90;

export async function adminSalesTrend(db: Database, now: Date, days = 30) {
  const rangeDays = Number.isFinite(days)
    ? Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.trunc(days)))
    : 30;
  const start = new Date(now.getTime() - (rangeDays - 1) * DAY_MS);

  type TrendRow = {
    day: string;
    new_purchases: number | string | bigint;
    renewals: number | string | bigint;
  };

  const result = await db.execute(sql`
    with paid_ranked as (
      select
        coalesce(p.user_id::text, 'payment:' || p.id::text) as customer_key,
        coalesce(p.applied_at, p.created_at) as paid_at,
        row_number() over (
          partition by coalesce(p.user_id::text, 'payment:' || p.id::text)
          order by coalesce(p.applied_at, p.created_at), p.created_at, p.id
        ) as purchase_number
      from payments p
      where p.status = 'paid'
    ), calendar as (
      select generate_series(
        (${start.toISOString()}::timestamptz at time zone 'Asia/Tehran')::date,
        (${now.toISOString()}::timestamptz at time zone 'Asia/Tehran')::date,
        interval '1 day'
      )::date as day
    )
    select
      to_char(c.day, 'YYYY-MM-DD') as day,
      count(p.customer_key) filter (where p.purchase_number = 1) as new_purchases,
      count(p.customer_key) filter (where p.purchase_number > 1) as renewals
    from calendar c
    left join paid_ranked p
      on (p.paid_at at time zone 'Asia/Tehran')::date = c.day
    group by c.day
    order by c.day asc
  `);

  const points = rowsOf<TrendRow>(result).map((row) => ({
    date: row.day,
    newPurchases: Number(row.new_purchases ?? 0),
    renewals: Number(row.renewals ?? 0),
  }));

  return {
    days: rangeDays,
    points,
    totals: points.reduce(
      (acc, point) => {
        acc.newPurchases += point.newPurchases;
        acc.renewals += point.renewals;
        return acc;
      },
      { newPurchases: 0, renewals: 0 },
    ),
  };
}
