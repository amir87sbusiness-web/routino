// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * Price computation — server-authoritative.
 *
 * The client used to compute this (`priceOf()` in `src/routes/subscribe.tsx`)
 * and hand the result to the "gateway". Anyone with devtools could pay 1 Toman
 * for a year. The client may now only name a plan and a code; every number comes
 * from here.
 */
import { and, count, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { discounts, payments, plans, redemptions } from "../db/schema.ts";
import { badRequest, notFound } from "../lib/http-errors.ts";

/** How long an unfinished checkout keeps holding a slot on a limited code. Long
 * enough to cover a slow gateway round-trip, short enough that an abandoned
 * checkout frees the slot again with nobody intervening. */
const RESERVATION_MINUTES = 30;

/**
 * Slots consumed on a limited code: everyone who has already paid, plus everyone
 * else currently sitting at the gateway with it.
 *
 * `used_count` alone is written only when a payment succeeds, which left a hole
 * the width of the whole checkout→payment window — with `max_uses = 1`, every
 * user who reached the gateway before the first one paid also got the discount.
 *
 * Settled use is `max(used_count, redemptions)`, not either one alone:
 * `redeemDiscount` writes both, but an admin can raise `used_count` by hand to
 * retire a code, and rows predating the redemptions ledger have a count and no
 * rows. Taking the larger keeps both of those working while the in-flight term
 * closes the window.
 *
 * The caller's own in-flight payment is excluded: they are capped to one
 * redemption by the `redemptions` primary key anyway, and counting it would make
 * a user's own retry report the code as exhausted.
 */
async function slotsTaken(
  db: Database,
  code: string,
  usedCount: number,
  userId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - RESERVATION_MINUTES * 60_000);
  const [redeemed] = await db
    .select({ n: count() })
    .from(redemptions)
    .where(eq(redemptions.code, code));
  const [inFlight] = await db
    .select({ n: count() })
    .from(payments)
    .where(
      and(
        eq(payments.discountCode, code),
        ne(payments.userId, userId),
        isNull(payments.appliedAt),
        inArray(payments.status, [
          "pending",
          "requesting",
          "redirected",
          "provider_unknown",
          "verifying",
        ]),
        gt(payments.createdAt, since),
      ),
    );
  return Math.max(usedCount, redeemed?.n ?? 0) + (inFlight?.n ?? 0);
}

export interface Quote {
  planId: string;
  months: number;
  basePriceToman: number;
  offerPercent: number;
  discountPercent: number;
  discountCode: string | null;
  finalToman: number;
  /** What actually goes to ZarinPal, in Rial. */
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
  if (d.expiresAt && d.expiresAt <= now)
    return { valid: false, percent: 0, code: null, reason: "expired" };
  if (d.maxUses != null && (await slotsTaken(db, d.code, d.usedCount, userId, now)) >= d.maxUses)
    return { valid: false, percent: 0, code: null, reason: "exhausted" };
  if (d.phone && d.phone !== userPhone)
    return { valid: false, percent: 0, code: null, reason: "other_user" };

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

/** Computes the quote and exposes the exact discount validation result from the
 * same pass. The quote-preview route needs both; returning them together avoids
 * running the discount queries twice for one button press. */
export async function quoteWithDiscount(
  db: Database,
  planId: string,
  rawCode: string | null | undefined,
  userId: string,
  userPhone: string,
  now: Date,
  offerPercent = 0,
  allowFree = false,
): Promise<{ quote: Quote; discount: DiscountCheck }> {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.active, true)))
    .limit(1);
  if (!plan) throw notFound("unknown_plan", `No active plan '${planId}'`);

  const discount = await checkDiscount(db, rawCode, userId, userPhone, now);

  // Offer and discount stack multiplicatively — same order the client UI has
  // always shown, so the displayed price matches what gets charged.
  let price = plan.priceToman;
  if (offerPercent > 0) price = Math.round((price * (100 - offerPercent)) / 100);
  if (discount.valid) price = Math.round((price * (100 - discount.percent)) / 100);

  // ZarinPal has a minimum charge; a 100% discount would also
  // mean "free", which should never reach a payment gateway at all.
  if (price <= 0 && !allowFree)
    throw badRequest("free_plan", "Discounted price is zero; grant directly instead of charging");
  if (price < 0) price = 0;

  return {
    quote: {
      planId: plan.id,
      months: plan.months,
      basePriceToman: plan.priceToman,
      offerPercent,
      discountPercent: discount.valid ? discount.percent : 0,
      discountCode: discount.code,
      finalToman: price,
      finalRial: tomanToRial(price),
    },
    discount,
  };
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
  return (
    await quoteWithDiscount(db, planId, rawCode, userId, userPhone, now, offerPercent, allowFree)
  ).quote;
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
  // Capped, and atomic. The money has already moved, so a code that somehow
  // slipped past its limit still grants the subscription — but `used_count` must
  // never climb above `max_uses`, or the admin panel reports a nonsense number
  // and nobody notices the leak. A refused bump means exactly that happened.
  const bumped = await db
    .update(discounts)
    .set({ usedCount: sql`${discounts.usedCount} + 1` })
    .where(
      and(
        eq(discounts.code, code),
        or(isNull(discounts.maxUses), lt(discounts.usedCount, discounts.maxUses)),
      ),
    )
    .returning();
  if (!bumped.length) {
    console.warn("discount redeemed past its limit — investigate", { code, userId, paymentId });
  }
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
