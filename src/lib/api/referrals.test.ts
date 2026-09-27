import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ authedRequest: vi.fn() }));
vi.mock("./auth", () => auth);

import {
  claimReferralCode,
  ensureReferralSummaryCached,
  fetchReferralSummary,
  normalizeReferralCode,
  readCachedReferralSummary,
  refreshReferralSummary,
} from "./referrals";

const eligible = {
  referralCode: "ABCDEF",
  rewardDays: 7 as const,
  successfulInvites: 2,
  earnedDays: 14,
  claimState: { status: "eligible" as const },
};

describe("referrals API", () => {
  beforeEach(() => {
    auth.authedRequest.mockReset();
    localStorage.clear();
  });

  it("normalizes referral input to six uppercase ASCII letters", () => {
    expect(normalizeReferralCode(" ab-12cDefg ")).toBe("ABCDEF");
  });

  it("loads the summary with one authenticated request", async () => {
    auth.authedRequest.mockResolvedValue(eligible);
    expect(await fetchReferralSummary("user-1")).toEqual(eligible);
    expect(auth.authedRequest).toHaveBeenCalledOnce();
    expect(auth.authedRequest).toHaveBeenCalledWith("/referrals/me", {
      expectedUserId: "user-1",
    });
    expect(readCachedReferralSummary("user-1")).toEqual(eligible);
  });

  it("reuses the user-scoped cache without a network request", async () => {
    auth.authedRequest.mockResolvedValue(eligible);
    await refreshReferralSummary("user-1");
    auth.authedRequest.mockClear();

    expect(await ensureReferralSummaryCached("user-1")).toEqual(eligible);
    expect(auth.authedRequest).not.toHaveBeenCalled();
    expect(readCachedReferralSummary("user-2")).toBeNull();
  });

  it("ignores a corrupt cached summary", () => {
    localStorage.setItem("routino:referrals:v1:user-1", "{broken");
    expect(readCachedReferralSummary("user-1")).toBeNull();
    expect(localStorage.getItem("routino:referrals:v1:user-1")).toBeNull();
  });

  it("claims with one POST and returns that response without another GET", async () => {
    const claimed = {
      ...eligible,
      referralCode: "OWNCOD",
      claimState: { status: "claimed" as const },
    };
    auth.authedRequest.mockResolvedValue(claimed);
    expect(await claimReferralCode(" ab-cdef ", "user-1")).toEqual(claimed);
    expect(auth.authedRequest).toHaveBeenCalledOnce();
    expect(auth.authedRequest).toHaveBeenCalledWith("/referrals/claim", {
      method: "POST",
      body: { code: "ABCDEF" },
      expectedUserId: "user-1",
    });
    expect(readCachedReferralSummary("user-1")).toEqual(claimed);
  });
});
