/**
 * Price computation — server-authoritative.
 *
 * The client used to compute this (`priceOf()` in `src/routes/subscribe.tsx`)
 * and hand the result to the "gateway". Anyone with devtools could pay 1 Toman
 * for a year. The client may now only name a plan and a code; every number comes
 * from here.
 */
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { discounts, plans, redemptions } from "../db/schema.js";
import { badRequest, notFound } from "../plugins/errors.js";

export interface Quote {
  planId: string;
  months: number;
  basePriceToman: number;
  offerPercent: number;
  discountPercent: number;
  discountCode: string | null;
  finalToman: number;
  /** What actually goes to the PSP. Zibal bills in Rial. */
  finalRial: number;
}

/** Rial is the PSP's unit; Toman is the user's. The ×10 lives here and nowhere
 * else, so it can't drift. */
export const tomanToRial = (toman: number): number => toman * 10;

export interface DiscountCheck {
  valid: boolean;
  percent: number;
  code: string | null;
  reason?: "unknown" | "inactive" | "expired" | "exhausted" | "other_user" | "already_used";
}

export async function checkDiscount(
  db: Database,
  rawCode: string | null | undefined,
  userId: string,
  userPhone: string,
  now: Date,
): Promise<DiscountCheck> {
  if (!rawCode?.trim()) return { valid: false, percent: 0, code: null };
  const code = rawCode.trim().toUpperCase();

  const [d] = await db.select().from(discounts).where(eq(discounts.code, code)).limit(1);
  if (!d) return { valid: false, percent: 0, code: null, reason: "unknown" };
  if (!d.active) return { valid: false, percent: 0, code: null, reason: "inactive" };
  if (d.expiresAt && d.expiresAt <= now) return { valid: false, percent: 0, code: null, reason: "expired" };
  if (d.maxUses != null && d.usedCount >= d.maxUses) return { valid: false, percent: 0, code: null, reason: "exhausted" };
  if (d.phone && d.phone !== userPhone) return { valid: false, percent: 0, code: null, reason: "other_user" };

  // One redemption per user, enforced by the redemptions PK at write time; this
  // is the friendly check that avoids a constraint violation at checkout.
  const [already] = await db
    .select()
    .from(redemptions)
    .where(and(eq(redemptions.code, code), eq(redemptions.userId, userId)))
    .limit(1);
  if (already) return { valid: false, percent: 0, code: null, reason: "already_used" };

  return { valid: true, percent: d.percent, code: d.code };
}

export async function quote(
  db: Database,
  planId: string,
  rawCode: string | null | undefined,
  userId: string,
  userPhone: string,
  now: Date,
  offerPercent = 0,
  /** The checkout route grants a zero-priced quote directly instead of sending
   * it to the gateway; everyone else treats zero as an error. */
  allowFree = false,
): Promise<Quote> {
  const [plan] = await db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.active, true))).limit(1);
  if (!plan) throw notFound("unknown_plan", `No active plan '${planId}'`);

  const d = await checkDiscount(db, rawCode, userId, userPhone, now);

  // Offer and discount stack multiplicatively — same order the client UI has
  // always shown, so the displayed price matches what gets charged.
  let price = plan.priceToman;
  if (offerPercent > 0) price = Math.round((price * (100 - offerPercent)) / 100);
  if (d.valid) price = Math.round((price * (100 - d.percent)) / 100);

  // Zibal rejects amounts <= 1000 Rial (result 105). A 100% discount would also
  // mean "free", which should never reach a payment gateway at all.
  if (price <= 0 && !allowFree) throw badRequest("free_plan", "Discounted price is zero; grant directly instead of charging");
  if (price < 0) price = 0;

  return {
    planId: plan.id,
    months: plan.months,
    basePriceToman: plan.priceToman,
    offerPercent,
    discountPercent: d.valid ? d.percent : 0,
    discountCode: d.code,
    finalToman: price,
    finalRial: tomanToRial(price),
  };
}

/** Marks a code used. Called inside the grant transaction, never before payment
 * succeeds — otherwise an abandoned checkout burns a use. */
export async function redeemDiscount(
  db: Database,
  code: string,
  userId: string,
  paymentId: string,
): Promise<void> {
  await db.insert(redemptions).values({ code, userId, paymentId }).onConflictDoNothing();
  await db
    .update(discounts)
    .set({ usedCount: sql`${discounts.usedCount} + 1` })
    .where(eq(discounts.code, code));
}

export async function activePlans(db: Database) {
  return db.select().from(plans).where(eq(plans.active, true));
}

/** Codes that are currently usable by anyone — used only for surfacing an
 * "offer" banner, never for validation. */
export async function publicDiscountExists(db: Database, now: Date) {
  const [row] = await db
    .select()
    .from(discounts)
    .where(
      and(
        eq(discounts.active, true),
        isNull(discounts.phone),
        or(isNull(discounts.expiresAt), gt(discounts.expiresAt, now)),
      ),
    )
    .limit(1);
  return row ?? null;
}
