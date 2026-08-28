import { and, count, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { grants, payments } from "../db/schema.js";
import { badRequest, conflict, notFound, serviceUnavailable, tooMany } from "../lib/http-errors.js";
import { toLocalPhone } from "../lib/phone.js";
import type { PspProvider, PspVerifyResult } from "../providers/psp/index.js";
import { extendEntitlement, readEntitlement, type Entitlement } from "./entitlement.js";
import { quote, redeemDiscount } from "./pricing.js";

export type PaymentRow = typeof payments.$inferSelect;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_CHECKOUTS_PER_HOUR = 10;
const VERIFY_LEASE_MS = 30_000;
const SETTLE_WINDOW_MS = 72 * 3_600_000;
const SETTLE_MAX = 3;

function requestedCode(code: string | undefined): string | null {
  const normalized = code?.trim().toUpperCase();
  return normalized || null;
}

function attemptInputsMatch(
  payment: PaymentRow,
  body: { planId: string; code?: string; platform?: "web" | "android" | "ios" },
): boolean {
  return (
    payment.planId === body.planId &&
    payment.platform === (body.platform ?? "web") &&
    payment.discountCode === requestedCode(body.code)
  );
}

async function readPayment(db: Database, id: string): Promise<PaymentRow | undefined> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return payment;
}

export type CheckoutResult =
  | { free: true; paymentId: string; entitlement: Entitlement }
  | { free: false; paymentId: string; authority: string; paymentUrl: string; amountToman: number };

async function existingAttemptResult(
  db: Database,
  psp: PspProvider,
  payment: PaymentRow,
  body: { planId: string; code?: string; platform?: "web" | "android" | "ios" },
  t: Date,
): Promise<CheckoutResult> {
  if (!attemptInputsMatch(payment, body)) {
    throw conflict(
      "duplicate_payment_attempt",
      "This payment attempt was already used with different checkout details.",
    );
  }
  if (payment.amountToman <= 0 && payment.appliedAt) {
    return {
      free: true,
      paymentId: payment.id,
      entitlement: await readEntitlement(db, payment.userId, t),
    };
  }
  if (payment.authority && ["redirected", "verifying", "paid"].includes(payment.status)) {
    return {
      free: false,
      paymentId: payment.id,
      authority: payment.authority,
      paymentUrl: psp.startUrl(payment.authority),
      amountToman: payment.amountToman,
    };
  }
  if (payment.status === "provider_unknown" || payment.status === "requesting") {
    throw serviceUnavailable(
      "payment_request_unknown",
      "The earlier request may have reached ZarinPal. It was not sent again.",
    );
  }
  throw conflict("duplicate_payment_attempt", "This payment attempt cannot be reused.");
}

/** Payment grant, entitlement extension and paid marker commit atomically. */
export async function applyPaid(
  db: Database,
  payment: PaymentRow,
  verified:
    | Extract<PspVerifyResult, { kind: "paid" | "already_verified" }>
    | {
        kind: "paid";
        code: 100;
        refNumber?: string;
        cardNumber?: string;
      },
  t: Date,
  authority = payment.authority,
): Promise<void> {
  const granted = await db.transaction(async (tx) => {
    const [insertedGrant] = await tx
      .insert(grants)
      .values({
        userId: payment.userId,
        months: payment.months,
        days: 0,
        source: "payment",
        paymentId: payment.id,
        expiresBefore: null,
        expiresAfter: null,
        createdAt: t,
      })
      .onConflictDoNothing()
      .returning();

    if (!insertedGrant) return false;

    const extension = await extendEntitlement(
      tx,
      payment.userId,
      { planId: payment.planId, months: payment.months },
      t,
    );
    await tx
      .update(grants)
      .set({ expiresBefore: extension.before, expiresAfter: extension.after })
      .where(eq(grants.id, insertedGrant.id));
    await tx
      .update(payments)
      .set({
        status: "paid",
        authority,
        refNumber: verified.refNumber ?? payment.refNumber,
        cardNumber: verified.cardNumber ?? payment.cardNumber,
        pspResult: verified.code,
        paidAt: payment.paidAt ?? t,
        verifiedAt: t,
        verifyStartedAt: null,
        appliedAt: t,
        updatedAt: t,
      })
      .where(eq(payments.id, payment.id));
    return true;
  });

  if (granted && payment.discountCode) {
    try {
      await redeemDiscount(db, payment.discountCode, payment.userId, payment.id);
    } catch (err) {
      console.error("discount redemption failed after atomic payment grant", {
        paymentId: payment.id,
        err,
      });
    }
  }
}

export async function checkoutPayment(
  db: Database,
  env: { PUBLIC_API_URL: string },
  psp: PspProvider,
  user: { id: string; phone: string },
  body: {
    planId: string;
    attemptId: string;
    code?: string;
    platform?: "web" | "android" | "ios";
  },
  t: Date,
): Promise<CheckoutResult> {
  const [prior] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.userId, user.id), eq(payments.attemptId, body.attemptId)))
    .limit(1);
  if (prior) return existingAttemptResult(db, psp, prior, body, t);

  const since = new Date(t.getTime() - 3_600_000);
  const [recent] = await db
    .select({ n: count() })
    .from(payments)
    .where(and(eq(payments.userId, user.id), gt(payments.createdAt, since)));
  if ((recent?.n ?? 0) >= MAX_CHECKOUTS_PER_HOUR) {
    throw tooMany("Too many payment attempts. Try again later.", 3600);
  }

  const priced = await quote(db, body.planId, body.code ?? null, user.id, user.phone, t, 0, true);
  const [payment] = await db
    .insert(payments)
    .values({
      userId: user.id,
      planId: priced.planId,
      months: priced.months,
      amountToman: priced.finalToman,
      amountRial: priced.finalRial,
      discountCode: priced.discountCode,
      discountPercent: priced.discountPercent,
      offerPercent: priced.offerPercent,
      platform: body.platform ?? "web",
      attemptId: body.attemptId,
      status: priced.finalToman <= 0 ? "pending" : "requesting",
      requestStartedAt: priced.finalToman <= 0 ? null : t,
      createdAt: t,
      updatedAt: t,
    })
    .onConflictDoNothing()
    .returning();
  if (!payment) {
    const [raced] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.userId, user.id), eq(payments.attemptId, body.attemptId)))
      .limit(1);
    if (raced) return existingAttemptResult(db, psp, raced, body, t);
    throw new Error("failed to create payment");
  }

  if (priced.finalToman <= 0) {
    await applyPaid(db, payment, { kind: "paid", code: 100, refNumber: "FREE" }, t, null);
    return {
      free: true,
      paymentId: payment.id,
      entitlement: await readEntitlement(db, user.id, t),
    };
  }

  const callbackUrl = new URL(`${env.PUBLIC_API_URL}/v1/payments/callback`);
  callbackUrl.searchParams.set("paymentId", payment.id);
  const result = await psp.request({
    amountRial: priced.finalRial,
    callbackUrl: callbackUrl.toString(),
    description: `Routino ${priced.planId} (${priced.months}m)`,
    mobile: toLocalPhone(user.phone),
  });

  if (result.kind !== "issued") {
    const ambiguous = result.kind === "unknown";
    await db
      .update(payments)
      .set({
        status: ambiguous ? "provider_unknown" : "failed",
        pspResult: result.code ?? null,
        updatedAt: t,
      })
      .where(eq(payments.id, payment.id));
    if (ambiguous) {
      throw serviceUnavailable(
        "payment_request_unknown",
        "ZarinPal did not return a trustworthy response. No automatic retry was sent.",
      );
    }
    throw badRequest("psp_failed", "ZarinPal rejected the payment request.");
  }

  await db
    .update(payments)
    .set({
      status: "redirected",
      authority: result.authority,
      pspResult: result.code,
      updatedAt: t,
    })
    .where(and(eq(payments.id, payment.id), eq(payments.status, "requesting")));

  return {
    free: false,
    paymentId: payment.id,
    authority: result.authority,
    paymentUrl: psp.startUrl(result.authority),
    amountToman: priced.finalToman,
  };
}

export interface CallbackOutcome {
  outcome: "paid" | "canceled" | "failed" | "verify_failed" | "pending";
  payment?: PaymentRow;
  message?: string;
}

interface VerifyOutcome extends CallbackOutcome {
  changed: boolean;
}

async function releaseVerifyLease(
  db: Database,
  paymentId: string,
  t: Date,
  code?: number,
): Promise<PaymentRow | undefined> {
  await db
    .update(payments)
    .set({ verifyStartedAt: null, pspResult: code ?? undefined, updatedAt: t })
    .where(and(eq(payments.id, paymentId), isNull(payments.appliedAt)));
  return readPayment(db, paymentId);
}

async function verifyAndApplyPayment(
  db: Database,
  psp: PspProvider,
  payment: PaymentRow,
  t: Date,
  candidateAuthority?: string,
): Promise<VerifyOutcome> {
  if (payment.appliedAt) return { outcome: "paid", payment, changed: false };
  if (["failed", "verify_failed"].includes(payment.status)) {
    return { outcome: payment.status as "failed" | "verify_failed", payment, changed: false };
  }
  const authority = payment.authority ?? candidateAuthority;
  if (!authority) return { outcome: "pending", payment, changed: false };
  if (payment.authority && candidateAuthority && payment.authority !== candidateAuthority) {
    return { outcome: "pending", changed: false };
  }

  const staleBefore = new Date(t.getTime() - VERIFY_LEASE_MS);
  const [claimed] = await db
    .update(payments)
    .set({ status: "verifying", verifyStartedAt: t, updatedAt: t })
    .where(
      and(
        eq(payments.id, payment.id),
        isNull(payments.appliedAt),
        sql`${payments.status} not in ('failed', 'verify_failed')`,
        or(isNull(payments.verifyStartedAt), lt(payments.verifyStartedAt, staleBefore)),
      ),
    )
    .returning();
  if (!claimed) {
    const fresh = (await readPayment(db, payment.id)) ?? payment;
    return {
      outcome: fresh.appliedAt ? "paid" : "pending",
      payment: fresh.appliedAt ? fresh : undefined,
      changed: false,
    };
  }

  let verified: PspVerifyResult;
  try {
    verified = await psp.verify(authority, claimed.amountRial);
  } catch (err) {
    console.error("ZarinPal verify threw unexpectedly", { paymentId: claimed.id, err });
    const fresh = await releaseVerifyLease(db, claimed.id, t);
    return { outcome: fresh?.appliedAt ? "paid" : "pending", payment: fresh, changed: false };
  }

  if (verified.kind === "paid" || verified.kind === "already_verified") {
    try {
      await applyPaid(db, claimed, verified, t, authority);
    } catch (err) {
      await releaseVerifyLease(db, claimed.id, t, verified.code);
      console.error("verified payment could not be atomically granted", {
        paymentId: claimed.id,
        err,
      });
      throw err;
    }
    const fresh = (await readPayment(db, claimed.id)) ?? claimed;
    return { outcome: "paid", payment: fresh, changed: true };
  }

  if (verified.kind === "pending" || verified.kind === "unknown") {
    const fresh = await releaseVerifyLease(db, claimed.id, t, verified.code);
    return { outcome: fresh?.appliedAt ? "paid" : "pending", payment: fresh, changed: false };
  }

  // A callback-supplied authority is unbound until a successful Verify. A bad
  // candidate must not poison the real row.
  if (!payment.authority && candidateAuthority) {
    const fresh = await releaseVerifyLease(db, claimed.id, t);
    return { outcome: fresh?.appliedAt ? "paid" : "pending", changed: false };
  }

  const status = verified.kind === "canceled" ? "canceled" : "failed";
  await db
    .update(payments)
    .set({ status, pspResult: verified.code ?? null, verifyStartedAt: null, updatedAt: t })
    .where(and(eq(payments.id, claimed.id), isNull(payments.appliedAt)));
  const fresh = (await readPayment(db, claimed.id)) ?? claimed;
  return { outcome: status, payment: fresh, changed: true };
}

/** Strict ZarinPal callback: paymentId + Authority + Status=OK|NOK. */
export async function handlePaymentCallback(
  db: Database,
  psp: PspProvider,
  rawQs: Record<string, unknown>,
  t: Date,
): Promise<CallbackOutcome> {
  const scalar = (key: string): string | undefined =>
    typeof rawQs[key] === "string" ? (rawQs[key] as string) : undefined;
  const paymentId = scalar("paymentId");
  const authority = scalar("Authority");
  const status = scalar("Status");
  const neutral: CallbackOutcome = { outcome: "pending" };

  if (
    !paymentId ||
    !UUID_RE.test(paymentId) ||
    !authority ||
    !["OK", "NOK"].includes(status ?? "")
  ) {
    return neutral;
  }
  const payment = await readPayment(db, paymentId);
  if (!payment || (payment.authority && payment.authority !== authority)) return neutral;
  if (payment.appliedAt) return { outcome: "paid", payment };
  // Status is only a browser hint. NOK never grants and never makes a recoverable
  // stored authority terminal; a later authenticated poll may still verify it.
  if (status !== "OK") return { outcome: "canceled", payment };

  const result = await verifyAndApplyPayment(db, psp, payment, t, authority);
  return { outcome: result.outcome, payment: result.payment, message: result.message };
}

export async function settleOne(
  db: Database,
  psp: PspProvider,
  payment: PaymentRow,
  t: Date,
): Promise<boolean> {
  if (
    payment.appliedAt ||
    !payment.authority ||
    ["failed", "canceled", "verify_failed"].includes(payment.status)
  ) {
    return false;
  }
  return (await verifyAndApplyPayment(db, psp, payment, t)).changed;
}

/** Bounded app-open recovery for callbacks/tabs that never returned. */
export async function settleOpenPayments(
  db: Database,
  psp: PspProvider,
  userId: string,
  t: Date,
): Promise<number> {
  const since = new Date(t.getTime() - SETTLE_WINDOW_MS);
  let healed = 0;
  try {
    const staleBefore = new Date(t.getTime() - VERIFY_LEASE_MS);
    const open = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.userId, userId),
          isNull(payments.appliedAt),
          inArray(payments.status, ["redirected", "verifying"]),
          or(isNull(payments.verifyStartedAt), lt(payments.verifyStartedAt, staleBefore)),
          gt(payments.createdAt, since),
        ),
      )
      .limit(SETTLE_MAX);
    for (const payment of open) {
      if (await settleOne(db, psp, payment, t)) healed += 1;
    }
  } catch (err) {
    console.error("settleOpenPayments failed", { userId, err });
  }
  return healed;
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

export async function pollPayment(
  db: Database,
  psp: PspProvider,
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
  await settleOne(db, psp, payment, t);
  [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
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
