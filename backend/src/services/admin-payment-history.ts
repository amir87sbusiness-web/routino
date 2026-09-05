/** Payment history including rows whose account has been deleted. */
import { sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.js";

export async function adminListPaymentsIncludingDeleted(
  db: Database,
  opts: { status?: string; limit?: number },
) {
  const n = Math.min(opts.limit || 50, 200);
  const status = opts.status?.trim() || null;
  const result = await db.execute(sql`
    select p.id,
           p.user_id,
           u.phone,
           u.username,
           p.plan_id,
           p.amount_toman,
           p.discount_code,
           p.status,
           p.authority,
           p.platform,
           p.ref_number,
           p.created_at,
           p.paid_at
      from payments p
      left join users u on u.id = p.user_id
     where ${status === null} or p.status = ${status}
     order by p.created_at desc
     limit ${n}
  `);
  return rowsOf<{
    id: string;
    user_id: string | null;
    phone: string | null;
    username: string | null;
    plan_id: string;
    amount_toman: number | string | bigint;
    discount_code: string | null;
    status: string;
    authority: string | null;
    platform: string | null;
    ref_number: string | null;
    created_at: Date | string;
    paid_at: Date | string | null;
  }>(result).map((row) => ({
    id: row.id,
    userId: row.user_id,
    phone: row.phone,
    username: row.username,
    planId: row.plan_id,
    amountToman: Number(row.amount_toman),
    discountCode: row.discount_code,
    status: row.status,
    authority: row.authority,
    platform: row.platform,
    refNumber: row.ref_number,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }));
}
