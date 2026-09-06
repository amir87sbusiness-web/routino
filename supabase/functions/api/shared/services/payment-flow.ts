// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import { and, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { grants, payments, users } from "../db/schema.ts";
import {
  badRequest,
  conflict,
  HttpError,
  notFound,
  serviceUnavailable,
  unauthorized,
} from "../lib/http-errors.ts";
import { toLocalPhone } from "../lib/phone.ts";
import type { PspProvider, PspVerifyResult } from "../providers/psp/index.ts";
import { extendEntitlement, readEntitlement, type Entitlement } from "./entitlement.ts";
import { quote, redeemDiscount } from "./pricing.ts";
import { acquireProviderLease, releaseProviderLease } from "./provider-capacity.ts";

export type PaymentRow = typeof payments.$inferSelect;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PSP_REQUEST_LEASE_MS = 30_000;
const PSP_BUSY_RETRY_SECONDS = 2;
const VERIFY_LEASE_MS = 30_000;
const VERIFY_BACKOFF_BASE_MS = 5_000;
const VERIFY_BACKOFF_MAX_MS = 5 * 60_000;
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
  // This lookup is user-scoped, but preserved financial history may have no
  // account after deletion and must never be reusable for a checkout.
  if (!payment.userId) {
    throw conflict("payment_account_deleted", "This payment belongs to a deleted account.");
  }
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
  // An anonymous history row is intentionally retained, but it can never add
  // entitlement or redeem a discount for a deleted account.
  const userId = payment.userId;
  if (!userId) {
    throw conflict("payment_account_deleted", "This payment belongs to a deleted account.");
  }
  const granted = await db.transaction(async (tx) => {
    const [insertedGrant] = await tx
      .insert(grants)
      .values({
        userId,
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
      userId,
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
        nextVerifyAt: null,
        appliedAt: t,
        updatedAt: t,
      })
      .where(eq(payments.id, payment.id));
    return true;
  });

  if (granted && payment.discountCode) {
    try {
      await redeemDiscount(db, payment.discountCode, userId, payment.id);
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
  env: { PUBLIC_API_URL: string; PSP_PROVIDER_MAX_CONCURRENCY: number },
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
  if (prior && !(prior.status === "requesting" && prior.requestStartedAt === null)) {
    return existingAttemptResult(db, psp, prior, body, t);
  }
  if (prior && !attemptInputsMatch(prior, body)) {
    return existingAttemptResult(db, psp, prior, body, t);
  }

  const priced = await quote(db, body.planId, body.code ?? null, user.id, user.phone, t, 0, true);
  let payment = prior;
  let ownsRequest = false;
  if (!payment) {
    [payment] = await db
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
        checkoutProvider: psp.name,
        attemptId: body.attemptId,
        status: priced.finalToman <= 0 ? "pending" : "requesting",
        requestStartedAt: priced.finalToman <= 0 ? null : t,
        createdAt: t,
        updatedAt: t,
      })
      .onConflictDoNothing()
      .returning();
    ownsRequest = Boolean(payment && priced.finalToman > 0);
  }
  if (!payment) {
    const [raced] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.userId, user.id), eq(payments.attemptId, body.attemptId)))
      .limit(1);
    if (raced) return existingAttemptResult(db, psp, raced, body, t);
    const logicalConditions = [
      eq(payments.userId, user.id),
      eq(payments.planId, priced.planId),
      eq(payments.amountToman, priced.finalToman),
      priced.discountCode === null
        ? isNull(payments.discountCode)
        : eq(payments.discountCode, priced.discountCode),
      eq(payments.platform, body.platform ?? "web"),
      eq(payments.checkoutProvider, psp.name),
      isNull(payments.appliedAt),
      inArray(payments.status, [
        "pending",
        "requesting",
        "redirected",
        "provider_unknown",
        "verifying",
      ]),
    ];
    const [logical] = await db
      .select()
      .from(payments)
      .where(and(...logicalConditions))
      .limit(1);
    if (!logical) throw new Error("failed to create payment");
    if (!(logical.status === "requesting" && logical.requestStartedAt === null)) {
      return existingAttemptResult(db, psp, logical, body, t);
    }
    // The browser may have reloaded after provider_busy and lost its in-memory
    // attemptId. Resume the same unissued logical row; never create another.
    payment = logical;
  }

  if (priced.finalToman <= 0) {
    await applyPaid(db, payment, { kind: "paid", code: 100, refNumber: "FREE" }, t, null);
    return {
      free: true,
      paymentId: payment.id,
      entitlement: await readEntitlement(db, user.id, t),
    };
  }

  if (!ownsRequest) {
    const [claimed] = await db
      .update(payments)
      .set({ requestStartedAt: t, updatedAt: t })
      .where(
        and(
          eq(payments.id, payment.id),
          eq(payments.status, "requesting"),
          isNull(payments.requestStartedAt),
        ),
      )
      .returning();
    if (!claimed) return existingAttemptResult(db, psp, payment, body, t);
    payment = claimed;
  }

  const providerLease = await acquireProviderLease(
    db,
    "psp",
    env.PSP_PROVIDER_MAX_CONCURRENCY,
    t,
    PSP_REQUEST_LEASE_MS,
  );
  if (!providerLease) {
    await db
      .update(payments)
      .set({ requestStartedAt: null, updatedAt: t })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "requesting")));
    const err = new HttpError(503, "provider_busy", "Payment provider is busy. Retry shortly.", {
      retryAfter: PSP_BUSY_RETRY_SECONDS,
      paymentId: payment.id,
    });
    (err as HttpError & { retryAfter?: number }).retryAfter = PSP_BUSY_RETRY_SECONDS;
    throw err;
  }

  const callbackUrl = new URL(`${env.PUBLIC_API_URL}/v1/payments/callback`);
  callbackUrl.searchParams.set("paymentId", payment.id);
  let result;
  try {
    result = await psp.request({
      amountRial: payment.amountRial,
      callbackUrl: callbackUrl.toString(),
      description: `Routino ${payment.planId} (${payment.months}m)`,
      mobile: toLocalPhone(user.phone),
    });
  } finally {
    await releaseProviderLease(db, "psp", providerLease.leaseId);
  }

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
  options: { bypassBackoff?: boolean } = {},
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
  const cooldownMs = Math.min(
    VERIFY_BACKOFF_MAX_MS,
    VERIFY_BACKOFF_BASE_MS * 2 ** Math.min(payment.verifyAttempts, 6),
  );
  const cooldownUntil = new Date(t.getTime() + cooldownMs);
  const [claimed] = await db
    .update(payments)
    .set({
      status: "verifying",
      verifyStartedAt: t,
      nextVerifyAt: cooldownUntil,
      verifyAttempts: sql`${payments.verifyAttempts} + 1`,
      updatedAt: t,
    })
    .where(
      and(
        eq(payments.id, payment.id),
        isNull(payments.appliedAt),
        sql`${payments.status} not in ('failed', 'verify_failed')`,
        or(isNull(payments.verifyStartedAt), lt(payments.verifyStartedAt, staleBefore)),
        options.bypassBackoff
          ? sql`true`
          : or(isNull(payments.nextVerifyAt), lte(payments.nextVerifyAt, t)),
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
    .set({
      status,
      pspResult: verified.code ?? null,
      verifyStartedAt: null,
      nextVerifyAt: null,
      updatedAt: t,
    })
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

  const result = await verifyAndApplyPayment(db, psp, payment, t, authority, {
    bypassBackoff: true,
  });
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
          or(isNull(payments.nextVerifyAt), lte(payments.nextVerifyAt, t)),
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
  const [owned] = await db
    .select({ accountId: users.id, payment: payments })
    .from(users)
    .leftJoin(payments, and(eq(payments.id, id), eq(payments.userId, users.id)))
    .where(eq(users.id, userId))
    .limit(1);
  if (!owned) throw unauthorized("unknown_user", "User no longer exists");
  let payment = owned.payment;
  if (!payment) throw notFound("unknown_payment", "No such payment");
  await settleOne(db, psp, payment, t);
  const [refreshed] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  payment = refreshed ?? null;
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
