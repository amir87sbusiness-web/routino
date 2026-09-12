// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import { payments } from "../db/schema.ts";
import type { PspProvider } from "../providers/psp/index.ts";
import { settleOne } from "./payment-flow.ts";

/**
 * Legacy operational/manual states stay readable/recoverable until every old
 * row has aged out. New checkout code does not create them anymore.
 */
export const RECOVERABLE_PAYMENT_STATUSES = [
  "pending",
  "requesting",
  "redirected",
  "provider_unknown",
  "verifying",
  "operational_error",
  "manual_review",
] as const;

export const PAYMENT_RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PROVIDER_FAILURE_GRACE_MS = 20 * 60 * 1000;

export interface PaymentRecoveryResult {
  success: true;
  checked: number;
  recovered: number;
  finalized: number;
  stillOpen: number;
  errors: number;
}

export interface PaymentRecoveryOptions {
  limit: number;
  maxConcurrent: number;
  onError?: (paymentId: string, error: unknown) => void;
}

/**
 * Canonical payment recovery sweep used by both Node/Fastify and Supabase Edge.
 * HTTP/auth wrappers deliberately live outside this module so payment state
 * transitions cannot drift between runtimes.
 */
export async function runPaymentRecoverySweep(
  db: Database,
  psp: PspProvider,
  now: Date,
  options: PaymentRecoveryOptions,
): Promise<PaymentRecoveryResult> {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit), 100));
  const since = new Date(now.getTime() - PAYMENT_RECOVERY_WINDOW_MS);
  const open = await db
    .select()
    .from(payments)
    .where(
      and(
        isNull(payments.appliedAt),
        isNotNull(payments.authority),
        gt(payments.createdAt, since),
        inArray(payments.status, [...RECOVERABLE_PAYMENT_STATUSES]),
        or(isNull(payments.nextVerifyAt), lte(payments.nextVerifyAt, now)),
      ),
    )
    .orderBy(asc(payments.createdAt))
    .limit(limit);

  let checked = 0;
  let recovered = 0;
  let finalized = 0;
  let stillOpen = 0;
  let errors = 0;

  for (const payment of open) {
    checked += 1;
    try {
      await settleOne(db, psp, payment, now, options.maxConcurrent);

      let [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
      if (!fresh) {
        errors += 1;
        continue;
      }
      if (fresh.appliedAt || fresh.status === "paid") {
        recovered += 1;
        continue;
      }
      if (["failed", "canceled", "verify_failed"].includes(fresh.status)) {
        finalized += 1;
        continue;
      }

      // ZarinPal -51/-55 can be transient around callback races. Keep one grace
      // period, then terminate the stale checkout so a fresh logical purchase is
      // not blocked forever. The row remains as financial history.
      const staleProviderFailure =
        (fresh.pspResult === -51 || fresh.pspResult === -55) &&
        now.getTime() - fresh.createdAt.getTime() >= PROVIDER_FAILURE_GRACE_MS;
      if (staleProviderFailure) {
        [fresh] = await db
          .update(payments)
          .set({
            status: "failed",
            verifyStartedAt: null,
            nextVerifyAt: null,
            updatedAt: now,
          })
          .where(and(eq(payments.id, fresh.id), isNull(payments.appliedAt)))
          .returning();
        if (fresh) finalized += 1;
        else stillOpen += 1;
        continue;
      }

      stillOpen += 1;
    } catch (error) {
      errors += 1;
      options.onError?.(payment.id, error);
    }
  }

  return { success: true, checked, recovered, finalized, stillOpen, errors };
}
