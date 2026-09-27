import { authedRequest } from "./auth";

const REFERRAL_CACHE_PREFIX = "routino:referrals:v1:";
const refreshes = new Map<string, Promise<ReferralSummary>>();
const queuedRefreshes = new Map<string, Promise<ReferralSummary>>();
const REFERRAL_REFRESH_DELAY_MS = 60_000;

export type ReferralClaimState =
  | { status: "eligible" }
  | { status: "claimed" }
  | {
      status: "ineligible";
      reason: "account_predates_program" | "paid_purchase_exists";
    };

export interface ReferralSummary {
  referralCode: string;
  rewardDays: 7;
  successfulInvites: number;
  earnedDays: number;
  claimState: ReferralClaimState;
}

function cacheKey(userId: string): string {
  return `${REFERRAL_CACHE_PREFIX}${userId}`;
}

function isReferralSummary(value: unknown): value is ReferralSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<ReferralSummary>;
  const claim = summary.claimState;
  const validClaim =
    !!claim &&
    (claim.status === "eligible" ||
      claim.status === "claimed" ||
      (claim.status === "ineligible" &&
        (claim.reason === "account_predates_program" || claim.reason === "paid_purchase_exists")));
  return (
    typeof summary.referralCode === "string" &&
    /^[A-Z]{6}$/.test(summary.referralCode) &&
    summary.rewardDays === 7 &&
    Number.isInteger(summary.successfulInvites) &&
    (summary.successfulInvites ?? -1) >= 0 &&
    Number.isInteger(summary.earnedDays) &&
    (summary.earnedDays ?? -1) >= 0 &&
    validClaim
  );
}

export function readCachedReferralSummary(userId: string): ReferralSummary | null {
  if (typeof localStorage === "undefined") return null;
  const key = cacheKey(userId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isReferralSummary(parsed)) return parsed;
    localStorage.removeItem(key);
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage may be unavailable in private or constrained browser contexts.
    }
  }
  return null;
}

export function cacheReferralSummary(userId: string, summary: ReferralSummary): ReferralSummary {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(cacheKey(userId), JSON.stringify(summary));
    } catch {
      // The caller still keeps this server response in React state for this session.
    }
  }
  return summary;
}

export function normalizeReferralCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 6);
}

export function refreshReferralSummary(expectedUserId: string): Promise<ReferralSummary> {
  const active = refreshes.get(expectedUserId);
  if (active) return active;
  const request = authedRequest<ReferralSummary>("/referrals/me", { expectedUserId })
    .then((summary) => cacheReferralSummary(expectedUserId, summary))
    .finally(() => refreshes.delete(expectedUserId));
  refreshes.set(expectedUserId, request);
  return request;
}

export function queueReferralSummaryRefresh(expectedUserId: string): Promise<ReferralSummary> {
  const queued = queuedRefreshes.get(expectedUserId);
  if (queued) return queued;

  const request = new Promise<ReferralSummary>((resolve, reject) => {
    setTimeout(() => {
      void refreshReferralSummary(expectedUserId).then(resolve, reject);
    }, REFERRAL_REFRESH_DELAY_MS);
  }).finally(() => queuedRefreshes.delete(expectedUserId));

  queuedRefreshes.set(expectedUserId, request);
  return request;
}

export function fetchReferralSummary(expectedUserId: string): Promise<ReferralSummary> {
  return refreshReferralSummary(expectedUserId);
}

export function ensureReferralSummaryCached(expectedUserId: string): Promise<ReferralSummary> {
  const cached = readCachedReferralSummary(expectedUserId);
  return cached ? Promise.resolve(cached) : refreshReferralSummary(expectedUserId);
}

export async function claimReferralCode(
  code: string,
  expectedUserId: string,
): Promise<ReferralSummary> {
  const summary = await authedRequest<ReferralSummary>("/referrals/claim", {
    method: "POST",
    body: { code: normalizeReferralCode(code) },
    expectedUserId,
  });
  return cacheReferralSummary(expectedUserId, summary);
}
