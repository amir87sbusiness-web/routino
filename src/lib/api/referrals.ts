import { authedRequest } from "./auth";

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

export function normalizeReferralCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 6);
}

export function fetchReferralSummary(expectedUserId: string): Promise<ReferralSummary> {
  return authedRequest("/referrals/me", { expectedUserId });
}

export function claimReferralCode(code: string, expectedUserId: string): Promise<ReferralSummary> {
  return authedRequest("/referrals/claim", {
    method: "POST",
    body: { code: normalizeReferralCode(code) },
    expectedUserId,
  });
}
