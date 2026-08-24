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
 *  - `grants.payment_id` is unique and the payment grant, entitlement update,
 *    and `payments.applied_at` write share one transaction, so however many
 *    callbacks or Edge isolates race, the grant happens exactly once.
 */
import { and, count, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.ts";
import { grants, payments } from "../db/schema.ts";
import {
  badGateway,
  badRequest,
  conflict,
  gatewayTimeout,
  notFound,
  serviceUnavailable,
  tooMany,
} from "../lib/http-errors.ts";
import { toLocalPhone } from "../lib/phone.ts";
import {
  ZIBAL_RESULT,
  ZIBAL_STATUS,
  type PspName,
  type PspRouter,
} from "../providers/psp/index.ts";
import { extendEntitlement, readEntitlement, type Entitlement } from "./entitlement.ts";
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
  return p.providerRef ?? p.authority ?? (p.trackId != null ? String(p.trackId) : undefined);
}

function requestedCode(code: string | undefined): string | null {
  const normalized = code?.trim().toUpperCase();
  return normalized ? normalized : null;
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

async function existingAttemptResult(
  db: Database,
  psp: PspRouter,
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

  const provider = paymentProvider(payment);
  const ref = paymentRef(payment);
  if (ref && ["redirected", "paid"].includes(payment.status)) {
    return {
      free: false,
      paymentId: payment.id,
      trackId: payment.trackId ?? undefined,
      paymentUrl: psp.startUrl(provider, ref),
      amountToman: payment.amountToman,
    };
  }

  throw conflict("duplicate_payment_attempt", "This payment attempt is already being processed.");
}

/** Applies a verified-paid payment exactly once.
 *
 * The unique grant insert, entitlement extension, grant audit fields, and
 * payment claim share one database transaction. The payment-linked grant is
 * the idempotency winner: a replay cannot reach the entitlement update. */
export async function applyPaid(
  db: Database,
  p: PaymentRow,
  v: {
    refNumber?: string;
    cardNumber?: string;
    result?: number;
    providerCode?: number;
    status?: number;
    provider?: PspName;
    providerRef?: string;
  },
  t: Date,
): Promise<void> {
  const granted = await db.transaction(async (tx) => {
    const [insertedGrant] = await tx
      .insert(grants)
      .values({
        userId: p.userId,
        months: p.months,
        days: 0,
        source: "payment",
        paymentId: p.id,
        expiresBefore: null,
        expiresAfter: null,
        createdAt: t,
      })
      .onConflictDoNothing()
      .returning();
    if (!insertedGrant) return false;

    const extension = await extendEntitlement(
      tx,
      p.userId,
      { planId: p.planId, months: p.months },
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
        refNumber: v.refNumber ?? p.refNumber,
        cardNumber: v.cardNumber ?? p.cardNumber,
        pspResult: v.providerCode ?? v.result ?? p.pspResult,
        pspStatus: v.status ?? p.pspStatus,
        provider: v.provider ?? p.provider,
        providerRef: v.providerRef ?? p.providerRef,
        paidAt: p.paidAt ?? t,
        verifiedAt: t,
        appliedAt: t,
        updatedAt: t,
      })
      .where(eq(payments.id, p.id));

    return true;
  });

  if (!granted) return;

  // Deliberately outside the atomic grant transaction. Discount redemption is
  // bookkeeping; the unique payment grant already makes a replay harmless.
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
  body: {
    planId: string;
    attemptId: string;
    code?: string;
    platform?: "web" | "android" | "ios";
  },
  t: Date,
): Promise<CheckoutResult> {
  const [priorAttempt] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.userId, user.id), eq(payments.attemptId, body.attemptId)))
    .limit(1);
  if (priorAttempt) return existingAttemptResult(db, psp, priorAttempt, body, t);

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
      attemptId: body.attemptId,
      status: "pending",
      createdAt: t,
      updatedAt: t,
    })
    .onConflictDoNothing()
    .returning();
  if (!payment) {
    const [racedAttempt] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.userId, user.id), eq(payments.attemptId, body.attemptId)))
      .limit(1);
    if (racedAttempt) return existingAttemptResult(db, psp, racedAttempt, body, t);
    throw new Error("failed to create payment");
  }

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
    const ambiguous = res.failureKind === "timeout" || res.failureKind === "unavailable";
    await db
      .update(payments)
      .set({
        status: ambiguous ? "provider_unknown" : "failed",
        provider: res.provider,
        pspResult: res.providerCode ?? res.result,
        updatedAt: t,
      })
      .where(eq(payments.id, payment.id));
    console.error("psp request failed", {
      paymentId: payment.id,
      provider: res.provider,
      result: res.providerCode ?? res.result,
      failureKind: res.failureKind,
    });
    if (res.failureKind === "timeout") {
      throw gatewayTimeout(
        "payment_network_timeout",
        "The payment provider did not answer in time. No retry was sent.",
      );
    }
    if (res.failureKind === "unavailable") {
      throw serviceUnavailable(
        "payment_provider_unavailable",
        "The payment provider is temporarily unavailable.",
      );
    }
    if (res.provider === "nextpay") {
      throw badGateway("nextpay_token_error", "NextPay could not create the payment transaction.");
    }
    throw badRequest("psp_failed", "Payment gateway rejected the request. Try again.");
  }

  // Store the token in the column its gateway uses: numeric trackId for
  // zibal/fake, string authority for zarinpal. Exactly one is set.
  const numericTrackId =
    res.provider === "zibal" || res.provider === "fake" ? Number(res.ref) : null;
  const authority = res.provider === "zarinpal" ? res.ref : null;

  await db
    .update(payments)
    .set({
      status: "redirected",
      provider: res.provider,
      providerRef: res.ref,
      trackId: numericTrackId,
      authority,
      pspResult: res.providerCode ?? res.result,
      updatedAt: t,
    })
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

const VERIFY_LEASE_MS = 30_000;

interface VerifyPaymentOutcome extends CallbackOutcome {
  changed: boolean;
}

interface VerifyCandidate {
  provider: PspName;
  ref: string;
  /** The callback supplied this reference after a token-persist crash. It is
   * untrusted until Verify returns the database order and amount. */
  bindOnSuccess: boolean;
}

async function readPayment(db: Database, id: string): Promise<PaymentRow | undefined> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
  return payment;
}

async function releaseVerifyLease(
  db: Database,
  paymentId: string,
  restoreStatus: string,
  t: Date,
  providerResult?: { result: number; providerCode?: number; status?: number },
): Promise<PaymentRow | undefined> {
  await db
    .update(payments)
    .set({
      status: restoreStatus,
      pspResult: providerResult
        ? (providerResult.providerCode ?? providerResult.result)
        : undefined,
      pspStatus: providerResult?.status ?? undefined,
      updatedAt: t,
    })
    .where(
      and(eq(payments.id, paymentId), eq(payments.status, "verifying"), isNull(payments.appliedAt)),
    );
  return readPayment(db, paymentId);
}

/** Claims one recoverable Verify lease and owns every provider result mapping.
 * A timeout or documented transient result releases the row back to its prior
 * recoverable state. Only authoritative terminal answers become terminal. */
async function verifyAndApplyPayment(
  db: Database,
  psp: PspRouter,
  payment: PaymentRow,
  t: Date,
  candidate?: VerifyCandidate,
): Promise<VerifyPaymentOutcome> {
  if (payment.appliedAt) return { outcome: "paid", payment, changed: false };
  const storedProvider = paymentProvider(payment);
  if (
    payment.status === "canceled" ||
    (payment.status === "failed" && storedProvider === "nextpay") ||
    payment.status === "verify_failed"
  ) {
    return {
      outcome: payment.status,
      payment,
      changed: false,
    };
  }

  const provider = candidate?.provider ?? paymentProvider(payment);
  const ref = candidate?.ref ?? paymentRef(payment);
  if (!ref) return { outcome: "pending", payment, changed: false };

  const restoreStatus = payment.status === "verifying" ? "redirected" : payment.status;
  const staleBefore = new Date(t.getTime() - VERIFY_LEASE_MS);
  const [claimed] = await db
    .update(payments)
    .set({ status: "verifying", updatedAt: t })
    .where(
      and(
        eq(payments.id, payment.id),
        isNull(payments.appliedAt),
        sql`${payments.status} not in ('canceled', 'verify_failed')`,
        or(
          ne(payments.status, "failed"),
          ne(payments.provider, "nextpay"),
          isNull(payments.provider),
        ),
        or(ne(payments.status, "verifying"), lt(payments.updatedAt, staleBefore)),
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

  let verified;
  try {
    verified = await psp.verify(provider, ref, claimed.amountRial);
  } catch (err) {
    console.error("psp verify unreachable", {
      paymentId: claimed.id,
      provider,
      failureKind: err instanceof Error ? err.name : "unknown",
    });
    const fresh = await releaseVerifyLease(db, claimed.id, restoreStatus, t);
    return {
      outcome: fresh?.appliedAt ? "paid" : "pending",
      payment: fresh,
      changed: false,
    };
  }

  const paidNow =
    verified.result === ZIBAL_RESULT.OK && verified.status === ZIBAL_STATUS.PAID_VERIFIED;
  const providerAllowsAlreadyVerified =
    provider !== "nextpay" && verified.result === ZIBAL_RESULT.ALREADY_VERIFIED;

  if (paidNow || providerAllowsAlreadyVerified) {
    const amountMismatch =
      paidNow && (typeof verified.amount !== "number" || verified.amount !== claimed.amountRial);
    const orderMismatch = provider === "nextpay" && verified.orderId !== claimed.id;
    if (amountMismatch || orderMismatch) {
      if (candidate?.bindOnSuccess) {
        const fresh = await releaseVerifyLease(db, claimed.id, restoreStatus, t);
        return {
          outcome: fresh?.appliedAt ? "paid" : "pending",
          payment: fresh?.appliedAt ? fresh : undefined,
          changed: false,
        };
      }
      await db
        .update(payments)
        .set({
          status: "verify_failed",
          pspResult: verified.providerCode ?? verified.result,
          pspStatus: verified.status ?? null,
          updatedAt: t,
        })
        .where(
          and(
            eq(payments.id, claimed.id),
            eq(payments.status, "verifying"),
            isNull(payments.appliedAt),
          ),
        );
      console.error("PAYMENT VERIFY MISMATCH — investigate immediately", {
        paymentId: claimed.id,
        provider,
        amountMismatch,
        orderMismatch,
      });
      const fresh = (await readPayment(db, claimed.id)) ?? claimed;
      return {
        outcome: fresh.appliedAt ? "paid" : "verify_failed",
        payment: fresh,
        changed: !fresh.appliedAt,
      };
    }

    await applyPaid(
      db,
      claimed,
      {
        ...verified,
        provider: candidate?.bindOnSuccess ? provider : undefined,
        providerRef: candidate?.bindOnSuccess ? ref : undefined,
      },
      t,
    );
    const fresh = (await readPayment(db, claimed.id)) ?? claimed;
    return { outcome: "paid", payment: fresh, changed: true };
  }

  if (
    verified.failureKind === "transient_verify" ||
    verified.failureKind === "invalid_response" ||
    verified.status === ZIBAL_STATUS.PENDING
  ) {
    const fresh = await releaseVerifyLease(
      db,
      claimed.id,
      restoreStatus,
      t,
      candidate?.bindOnSuccess ? undefined : verified,
    );
    return {
      outcome: fresh?.appliedAt ? "paid" : "pending",
      payment: fresh,
      changed: false,
    };
  }

  // A callback-supplied reference is not associated with this payment until a
  // successful Verify returns the stored order and amount. A terminal response
  // for an unbound candidate may simply describe a forged reference, so it must
  // not poison the real payment row.
  if (candidate?.bindOnSuccess) {
    const fresh = await releaseVerifyLease(db, claimed.id, restoreStatus, t);
    return {
      outcome: fresh?.appliedAt ? "paid" : "pending",
      payment: fresh?.appliedAt ? fresh : undefined,
      changed: false,
    };
  }

  const canceled = verified.status === ZIBAL_STATUS.CANCELED_BY_USER;
  await db
    .update(payments)
    .set({
      status: canceled ? "canceled" : "failed",
      pspResult: verified.providerCode ?? verified.result,
      pspStatus: verified.status ?? null,
      updatedAt: t,
    })
    .where(
      and(
        eq(payments.id, claimed.id),
        eq(payments.status, "verifying"),
        isNull(payments.appliedAt),
      ),
    );
  const fresh = (await readPayment(db, claimed.id)) ?? claimed;
  if (fresh.appliedAt) return { outcome: "paid", payment: fresh, changed: true };
  return {
    outcome: canceled ? "canceled" : "failed",
    payment: fresh,
    changed: true,
  };
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
  rawQs: Record<string, unknown>,
  t: Date,
): Promise<CallbackOutcome> {
  // A repeated query key (`?orderId=a&orderId=b`) arrives as an ARRAY, not the
  // string the old signature claimed — and this endpoint is public, so anyone
  // can send one. Collapsing to the first value is what stops `.toLowerCase()`
  // below from throwing: that TypeError surfaced as a 500, and because it only
  // fired once a trackId matched a real row, the 500 itself told a stranger
  // which payments exist.
  const q = (key: string): string | undefined => {
    const v = rawQs[key];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    return undefined;
  };

  const trackId = Number(q("trackId"));
  const authorityParam = q("Authority");
  const orderIdParam = q("orderId");
  const nextpayTransId = q("trans_id");
  const nextpayOrderId = q("order_id");

  let payment: PaymentRow | undefined;
  let recoveredNextpayRef: string | undefined;
  if (nextpayTransId) {
    [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.provider, "nextpay"), eq(payments.providerRef, nextpayTransId)))
      .limit(1);
    if (
      !payment &&
      nextpayOrderId &&
      UUID_RE.test(nextpayOrderId) &&
      UUID_RE.test(nextpayTransId)
    ) {
      const [candidate] = await db
        .select()
        .from(payments)
        .where(eq(payments.id, nextpayOrderId))
        .limit(1);
      if (
        candidate &&
        candidate.appliedAt == null &&
        candidate.providerRef == null &&
        (candidate.provider == null || candidate.provider === "nextpay") &&
        !["canceled", "failed", "verify_failed"].includes(candidate.status)
      ) {
        payment = candidate;
        recoveredNextpayRef = nextpayTransId;
      }
    }
  }
  if (!nextpayTransId && Number.isSafeInteger(trackId) && trackId > 0) {
    [payment] = await db.select().from(payments).where(eq(payments.trackId, trackId)).limit(1);
  }
  if (!nextpayTransId && !payment && authorityParam) {
    [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.authority, authorityParam))
      .limit(1);
  }
  if (!nextpayTransId && !payment && orderIdParam && UUID_RE.test(orderIdParam)) {
    [payment] = await db.select().from(payments).where(eq(payments.id, orderIdParam)).limit(1);
  }

  // ONE neutral answer for both "no such payment" and "you proved nothing", so
  // the page cannot be used to tell which trackIds are real. Answering the
  // distinct «پرداخت پیدا نشد» for a miss made this an existence oracle: a
  // stranger walking sequential trackIds could map exactly which ones had
  // payments behind them, which is a live read on sales volume.
  const neutral: CallbackOutcome = { outcome: "pending" };
  if (!payment) return neutral;

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
  const provider = recoveredNextpayRef ? "nextpay" : paymentProvider(payment);
  const proven =
    provider === "nextpay"
      ? nextpayTransId === (payment.providerRef ?? recoveredNextpayRef) &&
        nextpayOrderId?.toLowerCase() === payment.id.toLowerCase()
      : orderIdParam?.toLowerCase() === payment.id.toLowerCase() ||
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
  if (!proven) return neutral;

  // Already granted (double callback / refresh): render the final state without
  // calling the PSP again. Local success is the only safe NextPay replay proof.
  if (payment.appliedAt) return { outcome: "paid", payment };

  // The user canceled at the gateway. Zibal signals it with `success!=1`,
  // ZarinPal with `Status!=OK`. Verify would also tell us, but skipping the
  // round-trip for the common cancel case keeps the page fast.
  const userApproved = q("success") === "1" || q("Status") === "OK";
  if (provider !== "nextpay" && !userApproved) {
    await db
      .update(payments)
      .set({ status: "canceled", pspStatus: Number(q("status")) || null, updatedAt: t })
      .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
    return { outcome: "canceled", payment };
  }

  const result = await verifyAndApplyPayment(
    db,
    psp,
    payment,
    t,
    recoveredNextpayRef
      ? { provider: "nextpay", ref: recoveredNextpayRef, bindOnSuccess: true }
      : undefined,
  );
  return { outcome: result.outcome, payment: result.payment, message: result.message };
}

/**
 * Re-asks the gateway about one unfinished payment and applies the answer.
 *
 * This is the ONLY place that decides "the money moved after all", and both
 * callers — the status poll and the sign-in sweep — go through it, because two
 * copies of this decision is exactly how a money path grows a discrepancy.
 *
 * Returns true when the row changed.
 */
export async function settleOne(
  db: Database,
  psp: PspRouter,
  payment: PaymentRow,
  t: Date,
): Promise<boolean> {
  // "Not yet granted" rather than one status: any row that reached a gateway but
  // has no grant is money we may owe access for, whatever its local status says.
  // Cancelled and amount-mismatched rows are excluded — those must never grant,
  // and re-asking about them forever is pure spend against the merchant quota.
  const unsettled =
    payment.appliedAt == null &&
    payment.status !== "canceled" &&
    !(payment.status === "failed" && paymentProvider(payment) === "nextpay") &&
    payment.status !== "verify_failed";
  if (!unsettled) return false;
  return (await verifyAndApplyPayment(db, psp, payment, t)).changed;
}

/** How far back a stranded payment is still worth chasing on sign-in. */
const SETTLE_WINDOW_MS = 72 * 3_600_000;
/** Bounded so one pathological account can never make opening the app slow. */
const SETTLE_MAX = 3;

/**
 * Finishes payments that the browser never finished for us.
 *
 * The callback is a REDIRECT of the user's browser, and in Iran that browser is
 * often behind a VPN or a connection that drops at exactly the wrong moment. If
 * it never lands and the user does not return to the payment screen, the row
 * sits in `redirected` forever: money moved, nothing granted, and the only
 * recovery is the owner noticing a support message.
 *
 * So the app's own boot path finishes them. This runs on the sync pull — the one
 * request every app open already makes — and on the normal path it is a single
 * indexed SELECT that returns nothing. Only when there IS a stranded payment
 * does it cost a gateway round trip, and that round trip is now bounded by
 * PSP_TIMEOUT_MS.
 *
 * Also repairs legacy rows created before payment application became atomic:
 * an old process could have marked a payment applied before its grant landed.
 * New writes cannot create that split state, but the sweep remains for history.
 *
 * Never throws: a sweep failure must not stop someone opening their app.
 */
export async function settleOpenPayments(
  db: Database,
  psp: PspRouter,
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
          or(
            eq(payments.status, "redirected"),
            and(eq(payments.status, "verifying"), lt(payments.updatedAt, staleBefore)),
          ),
          gt(payments.createdAt, since),
        ),
      )
      .limit(SETTLE_MAX);

    for (const row of open) {
      if (await settleOne(db, psp, row, t)) healed += 1;
    }
  } catch (err) {
    console.error("settleOpenPayments: sweep failed", { userId, err });
  }

  try {
    // .toISOString() BEFORE interpolation, not just a `::timestamptz` cast in
    // the SQL text — see the identical fix and full explanation in
    // services/otp.ts. A raw JS Date reaching postgres.js (the edge deployment's
    // driver on Deno) throws while encoding the parameter, before the query or
    // its cast is even sent; node-postgres tolerates it, which is how this ran
    // clean in every local/PGlite test while crashing on every boot in production.
    const sinceIso = since.toISOString();
    const orphaned = await db.execute(sql`
      select p.* from payments p
       where p.user_id = ${userId}::uuid
         and p.applied_at is not null
         and p.status = 'paid'
         and p.created_at > ${sinceIso}::timestamptz
         and not exists (select 1 from grants g where g.payment_id = p.id)
       limit ${SETTLE_MAX}
    `);
    for (const row of rowsOf<{ id: string }>(orphaned)) {
      console.error("payment applied but never granted — repairing", { paymentId: row.id });
      const [payment] = await db.select().from(payments).where(eq(payments.id, row.id)).limit(1);
      if (!payment) continue;
      await applyPaid(
        db,
        payment,
        {
          refNumber: payment.refNumber ?? undefined,
          cardNumber: payment.cardNumber ?? undefined,
          result: payment.pspResult ?? undefined,
          status: payment.pspStatus ?? undefined,
        },
        t,
      );
      healed += 1;
    }
  } catch (err) {
    console.error("settleOpenPayments: grant repair failed", { userId, err });
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
  // `settleOne` owns that decision — see it for why the condition is "not yet
  // granted" rather than a single status.
  if (await settleOne(db, psp, payment, t)) {
    [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
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
