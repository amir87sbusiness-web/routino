import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";

/** Records authenticated app use on the existing sync request.
 *
 * The single UPDATE is intentional: the user row lock makes the daily counter
 * safe when two devices sync at once, while last_active_at never moves back if
 * an older request finishes later. A day follows the product's Tehran timezone.
 */
export async function touchUserActivity(db: Database, userId: string, now: Date): Promise<void> {
  const instant = now.toISOString();
  await db.execute(sql`
    update users
       set active_days = active_days + case
             when last_active_at is null
               or (last_active_at at time zone 'Asia/Tehran')::date
                  < (${instant}::timestamptz at time zone 'Asia/Tehran')::date
             then 1 else 0 end,
           last_active_at = greatest(
             coalesce(last_active_at, ${instant}::timestamptz),
             ${instant}::timestamptz
           )
     where id = ${userId}::uuid
  `);
}
