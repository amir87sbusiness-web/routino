import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";

/** Records one active day using an existing authenticated sync request.
 *
 * Cost discipline matters here: this statement is allowed to run on normal app
 * syncs, but it only performs a physical row update once per Tehran calendar
 * day. Repeated opens/syncs on the same day match zero rows, avoiding useless
 * MVCC versions, WAL and trigger/index churn. `last_active_at` therefore means
 * "first observed activity in the latest active day", which is sufficient for
 * admin recency and keeps the write budget bounded to <= 1/user/day.
 */
export async function touchUserActivity(db: Database, userId: string, now: Date): Promise<void> {
  await db.execute(userActivityUpdate(userId, now));
}

/** Reusable conditional UPDATE, also embedded in the exchange's pull CTE.
 * The predicate is rechecked after row-lock waits, so simultaneous calls still
 * count a Tehran day exactly once. No activity payload crosses the DB wire. */
export function userActivityUpdate(userId: string, now: Date) {
  const instant = now.toISOString();
  return sql`
    update users
       set active_days = active_days + 1,
           last_active_at = ${instant}::timestamptz
     where id = ${userId}::uuid
       and (
         last_active_at is null
         or (last_active_at at time zone 'Asia/Tehran')::date
            < (${instant}::timestamptz at time zone 'Asia/Tehran')::date
       )
  `;
}
