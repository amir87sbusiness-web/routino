/**
 * Payment + plan endpoints.
 *
 * The server owns every number. The client only ever names a plan and a code;
 * prices come back from `/payments/quote` and the final amount is whatever the
 * server puts on the payment row. Anything else re-opens the pay-1-Toman bug.
 */
import { ApiError, apiRequest } from "./client";
import { authedRequest, type ServerEntitlement } from "./auth";

export interface ServerPlan {
  id: string;
  nameFa: string;
  nameEn: string;
  months: number;
  price: number; // Toman
}

export async function fetchPlans(): Promise<{
  plans: ServerPlan[];
  offer: null | { label: string; percent: number; until: number };
}> {
  return apiRequest("/plans");
}

export interface QuoteResult {
  quote: {
    planId: string;
    months: number;
    basePriceToman: number;
    discountPercent: number;
    discountCode: string | null;
    finalToman: number;
  };
  discount: {
    valid: boolean;
    percent: number;
    code: string | null;
    reason?: "unknown" | "inactive" | "expired" | "exhausted" | "other_user" | "already_used";
  };
}

export async function fetchQuote(planId: string, code?: string): Promise<QuoteResult> {
  return authedRequest("/payments/quote", {
    method: "POST",
    body: { planId, code: code || undefined },
  });
}

export interface CheckoutResult {
  free: boolean;
  paymentId: string;
  authority?: string;
  paymentUrl?: string;
  amountToman?: number;
  entitlement?: ServerEntitlement;
}

export async function checkout(
  planId: string,
  code: string | undefined,
  platform: "web" | "android" | "ios",
  attemptId: string,
  signal?: AbortSignal,
): Promise<CheckoutResult> {
  return authedRequest("/payments/checkout", {
    method: "POST",
    body: { planId, code: code || undefined, platform, attemptId },
    signal,
  });
}

const PROVIDER_BUSY_MAX_RETRIES = 3;
const PROVIDER_BUSY_MAX_DELAY_MS = 8_000;

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

/** A short technical backpressure retry. It never creates a second logical
 * checkout: every call carries the caller's exact same attemptId. */
export async function checkoutWithProviderBusyRetry(
  planId: string,
  code: string | undefined,
  platform: "web" | "android" | "ios",
  attemptId: string,
  signal?: AbortSignal,
): Promise<CheckoutResult> {
  let retries = 0;
  while (true) {
    try {
      return await checkout(planId, code, platform, attemptId, signal);
    } catch (err) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (
        !(err instanceof ApiError) ||
        err.code !== "provider_busy" ||
        retries >= PROVIDER_BUSY_MAX_RETRIES
      ) {
        throw err;
      }
      const baseMs = Math.min(Math.max((err.retryAfter ?? 1) * 1_000, 500), 2_000);
      const delayMs = Math.min(baseMs * 2 ** retries, PROVIDER_BUSY_MAX_DELAY_MS);
      retries += 1;
      await abortableDelay(delayMs, signal);
    }
  }
}

export interface PaymentStatus {
  payment: {
    id: string;
    status:
      | "pending"
      | "requesting"
      | "redirected"
      | "verifying"
      | "provider_unknown"
      | "paid"
      | "failed"
      | "canceled"
      | "verify_failed";
    planId: string;
    months: number;
    amountToman: number;
    discountCode: string | null;
    refNumber: string | null;
    paidAt: string | null;
    createdAt: string;
  };
  entitlement: ServerEntitlement;
}

export async function fetchPayment(paymentId: string): Promise<PaymentStatus> {
  return authedRequest(`/payments/${paymentId}`);
}
