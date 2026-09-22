/**
 * Payment + plan endpoints.
 *
 * The server owns every number. The client only ever names a plan and a code;
 * prices come back from the server and the final amount is whatever the server
 * puts on the payment row. Anything else re-opens the pay-1-Toman bug.
 */
import { ApiError, apiRequest } from "./client";
import { authedRequest, type ServerEntitlement } from "./auth";

export interface ServerPlan {
  id: string;
  nameFa: string;
  nameEn: string;
  months: number;
  price: number; // Toman
  originalPrice: number | null;
  offer?: null | {
    first: { kind: "percent" | "fixed"; value: number };
    second: { kind: "percent" | "fixed"; value: number };
  };
}

export interface PlansResponse {
  plans: ServerPlan[];
  offer: null | { label: string; percent: number; until: number };
}

const PLANS_CACHE_KEY = "routino:plans:v2";
export const PLANS_CACHE_TTL_MS = 12 * 60 * 60_000;
const QUOTE_BATCH_CACHE_TTL_MS = 60_000;

interface PlansCacheEntry {
  value: PlansResponse;
  expiresAt: number;
}

let plansMemoryCache: PlansCacheEntry | null = null;
let batchEndpointUnavailable = false;
const quoteBatchCache = new Map<string, { expiresAt: number; byPlan: Map<string, QuoteResult> }>();

function isPlansResponse(value: unknown): value is PlansResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PlansResponse>;
  if (!Array.isArray(candidate.plans)) return false;
  if (
    !candidate.plans.every(
      (plan) =>
        !!plan &&
        typeof plan.id === "string" &&
        typeof plan.nameFa === "string" &&
        typeof plan.nameEn === "string" &&
        Number.isFinite(plan.months) &&
        Number.isFinite(plan.price) &&
        (plan.originalPrice === null || Number.isFinite(plan.originalPrice)),
    )
  ) {
    return false;
  }
  const offer = candidate.offer;
  return (
    offer === null ||
    (!!offer &&
      typeof offer.label === "string" &&
      Number.isFinite(offer.percent) &&
      Number.isFinite(offer.until))
  );
}

function cacheExpiry(value: PlansResponse, now: number): number {
  const normalExpiry =
    now + (value.plans.some((plan) => plan.offer) ? 15 * 60_000 : PLANS_CACHE_TTL_MS);
  if (!value.offer) return normalExpiry;
  if (value.offer.until <= now) return now;
  return Math.min(normalExpiry, value.offer.until);
}

function readPlansCache(now = Date.now()): PlansResponse | null {
  if (plansMemoryCache && plansMemoryCache.expiresAt > now) return plansMemoryCache.value;
  plansMemoryCache = null;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PLANS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: unknown; expiresAt?: unknown };
    if (
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now ||
      !isPlansResponse(parsed.value)
    ) {
      window.localStorage.removeItem(PLANS_CACHE_KEY);
      return null;
    }
    plansMemoryCache = { value: parsed.value, expiresAt: parsed.expiresAt };
    return parsed.value;
  } catch {
    return null;
  }
}

function writePlansCache(value: PlansResponse, now = Date.now()) {
  const entry: PlansCacheEntry = { value, expiresAt: cacheExpiry(value, now) };
  plansMemoryCache = entry;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PLANS_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Private mode/storage pressure: the in-memory cache still saves repeats in
    // the current tab, and checkout remains fully server-authoritative.
  }
}

export async function fetchPlans(): Promise<PlansResponse> {
  const cached = readPlansCache();
  if (cached) return cached;

  // The application cache above is deliberately bounded. The actual network
  // request still bypasses the browser HTTP cache so an old service-worker or
  // intermediary response cannot extend that six-hour window by itself.
  const value = await apiRequest<PlansResponse>("/plans", { cache: "no-store" });
  if (isPlansResponse(value) && value.plans.length) writePlansCache(value);
  return value;
}

export interface QuoteResult {
  quote: {
    planId: string;
    months: number;
    basePriceToman: number;
    discountPercent: number;
    discountAmountToman: number;
    discountCode: string | null;
    finalToman: number;
  };
  discount: {
    valid: boolean;
    percent: number;
    amountToman: number;
    code: string | null;
    reason?:
      | "unknown"
      | "inactive"
      | "expired"
      | "exhausted"
      | "other_user"
      | "already_used"
      | "not_applicable";
  };
}

async function fetchSingleQuote(planId: string, code?: string): Promise<QuoteResult> {
  return authedRequest("/payments/quote", {
    method: "POST",
    body: { planId, code: code || undefined },
  });
}

export async function fetchQuoteBatch(planIds: string[], code?: string): Promise<QuoteResult[]> {
  const uniquePlanIds = [...new Set(planIds.filter(Boolean))];
  if (!uniquePlanIds.length) return [];
  const response = await authedRequest<{ quotes: QuoteResult[] }>("/payments/quote-batch", {
    method: "POST",
    body: { planIds: uniquePlanIds, code: code || undefined },
  });
  return response.quotes;
}

export async function fetchQuote(planId: string, code?: string): Promise<QuoteResult> {
  const normalizedCode = code?.trim().toUpperCase();
  const cachedPlans = readPlansCache();
  const planIds = cachedPlans?.plans.map((plan) => plan.id) ?? [];

  // Subscribe currently asks for each plan sequentially. When a code is being
  // checked, collapse those per-plan calls into one authenticated Edge request
  // and serve the remaining loop iterations from this short in-memory cache.
  if (normalizedCode && !batchEndpointUnavailable && planIds.length > 1) {
    const key = `${normalizedCode}|${planIds.join(",")}`;
    const now = Date.now();
    const cached = quoteBatchCache.get(key);
    if (cached && cached.expiresAt > now) {
      const hit = cached.byPlan.get(planId);
      if (hit) return hit;
    } else if (cached) {
      quoteBatchCache.delete(key);
    }

    try {
      const quotes = await fetchQuoteBatch(planIds, normalizedCode);
      const byPlan = new Map(quotes.map((quote) => [quote.quote.planId, quote]));
      quoteBatchCache.set(key, { expiresAt: now + QUOTE_BATCH_CACHE_TTL_MS, byPlan });
      const hit = byPlan.get(planId);
      if (hit) return hit;
    } catch (error) {
      // Safe rolling deploy: an already-published client may briefly reach an
      // older API version. Fall back only when the endpoint itself is absent;
      // auth/offline/provider errors keep their original semantics.
      if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
        batchEndpointUnavailable = true;
      } else {
        throw error;
      }
    }
  }

  return fetchSingleQuote(planId, normalizedCode);
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
 * checkout: every provider-busy retry carries the caller's exact same attemptId.
 *
 * A duplicate attempt is different: the server has told us that this logical
 * attempt is already terminal/non-reusable. Re-surfacing that same error code
 * would make the subscribe page retain the UUID and send it again forever.
 * Translate it to a non-retryable client error so the page discards the stale
 * UUID; a deliberate next click then creates one fresh checkout intent.
 */
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
      if (err instanceof ApiError && err.code === "duplicate_payment_attempt") {
        throw new ApiError(
          err.status,
          "payment_attempt_closed",
          err.message,
          err.offline,
          err.retryAfter,
          err.support,
        );
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
      | "verify_failed"
      | "manual_review";
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
