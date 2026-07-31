// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * The payment state machine — the money path, framework-free.
 *
 * Everything that decides whether money moved and whether access is granted
 * lives HERE, not in an HTTP route: checkout creation, the callback decision
 * tree, verification, the amount assertion, and apply-once idempotency. Both
 * HTTP layers (Fastify locally, the Supabase Edge Function in production) are
 * thin adapters over these functions, so the extensive payments test suite
 * exercises the exact code production runs.
 *
 * Core invariants (unchanged from the original route):
 *  - The client may only ever name a plan and a discount code; every number is
 *    computed server-side and re-asserted against what the gateway charged.
 *  - `success=1` / `Status=OK` in a callback URL is a CLAIM — only a
 *    server-to-server `psp.verify()` can mark a payment paid.
 *  - `payments.applied_at` is claimed with `UPDATE … WHERE applied_at IS NULL
 *    RETURNING`, so however many times a callback fires, the grant happens
 *    exactly once.
 */
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { payments } from "../db/schema.ts";
import { badRequest, notFound, tooMany } from "../lib/http-errors.ts";
import { toLocalPhone } from "../lib/phone.ts";
import { ZIBAL_RESULT, ZIBAL_STATUS, type PspName, type PspRouter } from "../providers/psp/index.ts";
import { grantInterval, readEntitlement, type Entitlement } from "./entitlement.ts";
import { quote, redeemDiscount } from "./pricing.ts";

export type PaymentRow = typeof payments.$inferSelect;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A user may not stockpile unbounded pending payments — each one is a PSP
 * round-trip and a DB row. Ten an hour is far beyond any honest retry. */
const MAX_CHECKOUTS_PER_HOUR = 10;

/** Which gateway owns a payment, for routing verify/callback back to it. Falls
 * back for rows written before `provider` existed: an `authority` means ZarinPal,
 * otherwise Zibal. */
function paymentProvider(p: PaymentRow): PspName {
  return (p.provider as PspName | null) ?? (p.authority ? "zarinpal" : "zibal");
}

/** The opaque gateway token for a payment: ZarinPal's string authority, else the
 * numeric trackId as a string. Undefined only if it never reached a gateway. */
function paymentRef(p: PaymentRow): string | undefined {
  return p.authority ?? (p.trackId != null ? String(p.trackId) : undefined);
}

/** Applies a verified-paid payment exactly once (claim → grant → redeem).
 * If granting fails after the claim, the claim is rolled back so a later
 * callback/refresh can retry — the user has paid; losing the grant is the one
 * unacceptable outcome. */
export async function applyPaid(
  db: Database,
  p: PaymentRow,
  v: { refNumber?: string; cardNumber?: string; result?: number; status?: number },
  t: Date,
): Promise<void> {
  const claimed = await db
    .update(payments)
    .set({
      status: "paid",
      refNumber: v.refNumber ?? p.refNumber,
      cardNumber: v.cardNumber ?? p.cardNumber,
      pspResult: v.result ?? p.pspResult,
      pspStatus: v.status ?? p.pspStatus,
      paidAt: p.paidAt ?? t,
      verifiedAt: t,
      appliedAt: t,
      updatedAt: t,
    })
    .where(and(eq(payments.id, p.id), isNull(payments.appliedAt)))
    .returning();
  if (!claimed.length) return; // another callback already applied it

  try {
    await grantInterval(
      db,
      p.userId,
      { planId: p.planId, months: p.months, source: "payment", paymentId: p.id },
      t,
    );
  } catch (err) {
    // Un-claim so the next callback or status poll can retry the grant.
    //
    // `status` MUST be restored too. Leaving it on "paid" while `applied_at` is
    // null used to strand the payment forever: the status poll's recovery branch
    // only re-verified rows still marked `redirected`, so a user whose grant
    // failed once showed "paid" and never received the subscription they had
    // already been charged for.
    await db
      .update(payments)
      .set({ status: p.status, appliedAt: null, updatedAt: t })
      .where(eq(payments.id, p.id));
    console.error("grant failed after payment — un-claimed for retry", {
      paymentId: p.id,
      userId: p.userId,
      err,
    });
    throw err;
  }

  // Deliberately OUTSIDE the un-claim above. Marking the discount used is
  // bookkeeping; the subscription is what the user paid for and it has now
  // landed. Letting this throw into that catch un-claimed a grant that had
  // already succeeded, and the retry re-ran `grantInterval` — which is not
  // idempotent (`grants.payment_id` has no unique constraint), so the user's
  // expiry was extended a second time for a single payment.
  if (p.discountCode) {
    try {
      await redeemDiscount(db, p.discountCode, p.userId, p.id);
    } catch (err) {
      console.error("discount redemption failed after a successful grant", {
        paymentId: p.id,
        code: p.discountCode,
        err,
      });
    }
  }
}

export type CheckoutResult =
  | { free: true; paymentId: string; entitlement: Entitlement }
  | { free: false; paymentId: string; trackId?: number; paymentUrl: string; amountToman: number };

/** Creates a payment, registers it with the fastest healthy gateway, and hands
 * back the redirect URL (or grants directly when the price is zero). */
export async function checkoutPayment(
  db: Database,
  env: { PUBLIC_API_URL: string },
  psp: PspRouter,
  user: { id: string; phone: string },
  body: { planId: string; code?: string; platform?: "web" | "android" | "ios" },
  t: Date,
): Promise<CheckoutResult> {
  const since = new Date(t.getTime() - 3_600_000);
  const [recent] = await db
    .select({ n: count() })
    .from(payments)
    .where(and(eq(payments.userId, user.id), gt(payments.createdAt, since)));
  if ((recent?.n ?? 0) >= MAX_CHECKOUTS_PER_HOUR) {
    throw tooMany("Too many payment attempts. Try again later.", 3600);
  }

  const q = await quote(db, body.planId, body.code ?? null, user.id, user.phone, t, 0, true);

  const [payment] = await db
    .insert(payments)
    .values({
      userId: user.id,
      planId: q.planId,
      months: q.months,
      amountToman: q.finalToman,
      amountRial: q.finalRial,
      discountCode: q.discountCode,
      discountPercent: q.discountPercent,
      offerPercent: q.offerPercent,
      platform: body.platform ?? "web",
      status: "pending",
      createdAt: t,
      updatedAt: t,
    })
    .returning();
  if (!payment) throw new Error("failed to create payment");

  // 100% discount: nothing to charge, so nothing goes near the gateway.
  // Grant directly through the same applied_at guard as a real payment.
  if (q.finalToman <= 0) {
    await applyPaid(db, payment, { refNumber: "FREE", result: 0, status: 0 }, t);
    return {
      free: true,
      paymentId: payment.id,
      entitlement: await readEntitlement(db, user.id, t),
    };
  }

  // The router picks the fastest healthy gateway and fails over if it rejects;
  // `res.provider` is whichever one actually took the payment.
  const res = await psp.request({
    amountRial: q.finalRial,
    callbackUrl: `${env.PUBLIC_API_URL}/v1/payments/callback`,
    orderId: payment.id,
    description: `Routino ${q.planId} (${q.months}m)`,
    mobile: toLocalPhone(user.phone),
  });

  if (!res.ok || !res.ref) {
    await db
      .update(payments)
      .set({ status: "failed", provider: res.provider, pspResult: res.result, updatedAt: t })
      .where(eq(payments.id, payment.id));
    console.error("psp request failed", { paymentId: payment.id, provider: res.provider, result: res.result });
    throw badRequest("psp_failed", "Payment gateway rejected the request. Try again.");
  }

  // Store the token in the column its gateway uses: numeric trackId for
  // zibal/fake, string authority for zarinpal. Exactly one is set.
  const numericTrackId = res.provider === "zarinpal" ? null : Number(res.ref);
  const authority = res.provider === "zarinpal" ? res.ref : null;

  await db
    .update(payments)
    .set({ status: "redirected", provider: res.provider, trackId: numericTrackId, authority, updatedAt: t })
    .where(eq(payments.id, payment.id));

  return {
    free: false,
    paymentId: payment.id,
    trackId: numericTrackId ?? undefined,
    paymentUrl: psp.startUrl(res.provider, res.ref),
    amountToman: q.finalToman,
  };
}

export interface CallbackOutcome {
  outcome: "paid" | "canceled" | "failed" | "verify_failed" | "pending";
  payment?: PaymentRow;
  message?: string;
}

/**
 * Decides the outcome of a gateway callback.
 *
 * Zibal redirects with `?trackId=&success=&status=&orderId=`; ZarinPal with
 * `?Authority=&Status=OK|NOK`. Both land here — the payment is identified by
 * whichever token is present, then verified against the provider recorded on its
 * row. Idempotent and safe against a forged query string.
 */
export async function handlePaymentCallback(
  db: Database,
  psp: PspRouter,
  qs: Record<string, string | undefined>,
  t: Date,
): Promise<CallbackOutcome> {
  const trackId = Number(qs.trackId);
  const authorityParam = qs.Authority;

  let payment: PaymentRow | undefined;
  if (Number.isSafeInteger(trackId) && trackId > 0) {
    [payment] = await db.select().from(payments).where(eq(payments.trackId, trackId)).limit(1);
  }
  if (!payment && authorityParam) {
    [payment] = await db.select().from(payments).where(eq(payments.authority, authorityParam)).limit(1);
  }
  if (!payment && qs.orderId && UUID_RE.test(qs.orderId)) {
    [payment] = await db.select().from(payments).where(eq(payments.id, qs.orderId)).limit(1);
  }

  if (!payment) return { outcome: "failed", message: "پرداخت پیدا نشد." };

  // Did this caller prove they came from the gateway, or did they merely *name* a
  // payment? `trackId` is a short sequential integer shown to every paying user,
  // so a stranger can guess one; our `orderId` (a UUID) and ZarinPal's `Authority`
  // cannot be. Every genuine callback carries one of the unguessable pair — we
  // send `orderId` on each Zibal request and it is echoed back on the redirect.
  //
  // Compare case-insensitively: Postgres matches `uuid` regardless of case (and
  // UUID_RE is case-insensitive), so the row above can be found by an upper-cased
  // orderId that would then fail a strict `===` against the canonical lower-case
  // `payment.id` — turning a legitimate caller away.
  const proven =
    qs.orderId?.toLowerCase() === payment.id.toLowerCase() ||
    (!!authorityParam && authorityParam === payment.authority);

  // Everything past this line either mutates the payment or discloses its state,
  // and this endpoint is public and unauthenticated. A caller who proved nothing
  // gets a neutral "still checking" page and NO payment object — echoing the row
  // back would hand them `payment.id`, which is itself the proof token they
  // lacked, plus the bank `refNumber` the result page prints on a paid outcome.
  //
  // This one gate is the fix for a real bug: `canceled` is terminal (the status
  // poll deliberately never revives it), so honouring an unproven cancel let
  // anyone who guessed a trackId strand a stranger's payment — the victim paid,
  // their own callback never landed (closed tab), and the poll refused to heal
  // the canceled row. Money moved, nothing granted.
  //
  // Placing it above the branches rather than on each one also keeps an unproven
  // caller from forcing an outbound `psp.verify()` round-trip per guessed
  // trackId, which is real spend against the merchant's gateway quota — the
  // production edge deployment has no rate limiter at all.
  if (!proven) return { outcome: "pending" };

  // Already granted (double callback / refresh): render the final state.
  if (payment.appliedAt) return { outcome: "paid", payment };

  // The user canceled at the gateway. Zibal signals it with `success!=1`,
  // ZarinPal with `Status!=OK`. Verify would also tell us, but skipping the
  // round-trip for the common cancel case keeps the page fast.
  const userApproved = qs.success === "1" || qs.Status === "OK";
  if (!userApproved) {
    await db
      .update(payments)
      .set({ status: "canceled", pspStatus: Number(qs.status) || null, updatedAt: t })
      .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
    return { outcome: "canceled", payment };
  }

  // From here on, the gateway's "approved" flag in the query string is a CLAIM,
  // nothing more — anyone can type that URL. Even a payment previously marked
  // failed or canceled is re-verified: a stale local status must never beat the
  // gateway's server-to-server answer, or a paid user loses their grant.
  const ref = paymentRef(payment);
  if (!ref) return { outcome: "pending", payment };
  let v;
  try {
    v = await psp.verify(paymentProvider(payment), ref, payment.amountRial);
  } catch (err) {
    console.error("psp verify unreachable", { err, paymentId: payment.id });
    // Do NOT mark failed: the money may have moved. Leave the row as-is; the
    // status poll and the next callback can retry verification.
    return { outcome: "pending", payment };
  }

  if (v.result === ZIBAL_RESULT.OK && v.status === ZIBAL_STATUS.PAID_VERIFIED) {
    if (typeof v.amount === "number" && v.amount !== payment.amountRial) {
      // The single scariest branch in the codebase: gateway says an amount we
      // never asked for. Never grant; flag loudly.
      await db
        .update(payments)
        .set({ status: "verify_failed", pspResult: v.result, pspStatus: v.status, updatedAt: t })
        .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
      console.error("PAYMENT AMOUNT MISMATCH — investigate immediately", {
        paymentId: payment.id,
        expectedRial: payment.amountRial,
        gotRial: v.amount,
      });
      return { outcome: "verify_failed", payment };
    }
    await applyPaid(db, payment, v, t);
    const [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
    return { outcome: "paid", payment: fresh ?? payment };
  }

  if (v.result === ZIBAL_RESULT.ALREADY_VERIFIED) {
    // Verified in a previous callback we never finished processing. Zibal's
    // 201 carries no amount, but the amount was asserted the first time; the
    // applied_at guard makes re-applying safe.
    await applyPaid(db, payment, v, t);
    const [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
    return { outcome: "paid", payment: fresh ?? payment };
  }

  if (v.status === ZIBAL_STATUS.PENDING) {
    // Not settled at the gateway yet (or a premature/forged callback). Leave
    // the row untouched so the real outcome can still land later.
    return { outcome: "pending", payment };
  }

  const canceled = v.status === ZIBAL_STATUS.CANCELED_BY_USER;
  await db
    .update(payments)
    .set({
      status: canceled ? "canceled" : "failed",
      pspResult: v.result,
      pspStatus: v.status ?? null,
      updatedAt: t,
    })
    .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
  return { outcome: canceled ? "canceled" : "failed", payment };
}

export interface PollResult {
  payment: {
    id: string;
    status: string;
    planId: string;
    months: number;
    amountToman: number;
    discountCode: string | null;
    refNumber: string | null;
    paidAt: Date | null;
    createdAt: Date;
  };
  entitlement: Entitlement;
}

/** Status poll for the app. Also the recovery path: a payment stuck in
 * `redirected` (callback never landed) gets re-verified here. */
export async function pollPayment(
  db: Database,
  psp: PspRouter,
  userId: string,
  id: string,
  t: Date,
): Promise<PollResult> {
  if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed payment id");

  let [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, id), eq(payments.userId, userId)))
    .limit(1);
  if (!payment) throw notFound("unknown_payment", "No such payment");

  // Self-heal: user returned but the callback never fired (network, closed tab),
  // or a grant failed after the money moved and was un-claimed for retry.
  //
  // The condition is deliberately "not yet applied" rather than a single status:
  // any row that reached a gateway but has no grant is money we may owe access
  // for, whatever its local status says. Only user-cancelled and
  // amount-mismatched rows are excluded — those must never grant, and re-asking
  // the gateway about them on every poll is pure cost.
  const unsettled =
    payment.appliedAt == null &&
    payment.status !== "canceled" &&
    payment.status !== "verify_failed";
  if (unsettled && (payment.trackId != null || payment.authority)) {
    try {
      const v = await psp.verify(paymentProvider(payment), paymentRef(payment)!, payment.amountRial);
      if (
        (v.result === ZIBAL_RESULT.OK && v.status === ZIBAL_STATUS.PAID_VERIFIED) ||
        v.result === ZIBAL_RESULT.ALREADY_VERIFIED
      ) {
        if (v.result === ZIBAL_RESULT.OK && typeof v.amount === "number" && v.amount !== payment.amountRial) {
          await db
            .update(payments)
            .set({ status: "verify_failed", pspResult: v.result, pspStatus: v.status ?? null, updatedAt: t })
            .where(eq(payments.id, payment.id));
          console.error("PAYMENT AMOUNT MISMATCH — investigate immediately", {
            paymentId: payment.id,
            expectedRial: payment.amountRial,
            gotRial: v.amount,
          });
        } else {
          await applyPaid(db, payment, v, t);
        }
      } else if (v.status === ZIBAL_STATUS.CANCELED_BY_USER) {
        await db
          .update(payments)
          .set({ status: "canceled", pspResult: v.result, pspStatus: v.status ?? null, updatedAt: t })
          .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
      }
      [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    } catch {
      /* verify unreachable — report current state; the client will poll again */
    }
  }
  if (!payment) throw notFound("unknown_payment", "No such payment");

  return {
    payment: {
      id: payment.id,
      status: payment.status,
      planId: payment.planId,
      months: payment.months,
      amountToman: payment.amountToman,
      discountCode: payment.discountCode,
      refNumber: payment.refNumber,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
    },
    entitlement: await readEntitlement(db, userId, t),
  };
}
