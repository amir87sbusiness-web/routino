import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ authedRequest: vi.fn() }));
vi.mock("./auth", () => auth);

import {
  claimReferralCode,
  ensureReferralSummaryCached,
  fetchReferralSummary,
  normalizeReferralCode,
  queueReferralSummaryRefresh,
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
const entitlement = {
  status: "active" as const,
  planId: "m3",
  startedAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-12-08T00:00:00.000Z",
  issuedAt: "2026-09-27T12:00:00.000Z",
  deletionAt: null,
};
const snapshot = { ...eligible, entitlement };

describe("referrals API", () => {
  beforeEach(() => {
    vi.useRealTimers();
    auth.authedRequest.mockReset();
    localStorage.clear();
  });

  it("normalizes referral input to six uppercase ASCII letters", () => {
    expect(normalizeReferralCode(" ab-12cDefg ")).toBe("ABCDEF");
  });

  it("loads the summary with one authenticated request", async () => {
    auth.authedRequest.mockResolvedValue(snapshot);
    expect(await fetchReferralSummary("user-1")).toEqual(snapshot);
    expect(auth.authedRequest).toHaveBeenCalledOnce();
    expect(auth.authedRequest).toHaveBeenCalledWith("/referrals/me", {
      expectedUserId: "user-1",
      cache: "no-store",
    });
    expect(readCachedReferralSummary("user-1")).toEqual(eligible);
  });

  it("reuses the user-scoped cache without a network request", async () => {
    auth.authedRequest.mockResolvedValue(snapshot);
    await refreshReferralSummary("user-1");
    auth.authedRequest.mockClear();

    expect(await ensureReferralSummaryCached("user-1")).toEqual(eligible);
    expect(auth.authedRequest).not.toHaveBeenCalled();
    expect(readCachedReferralSummary("user-2")).toBeNull();
  });

  it("refreshes immediately, then reuses that result for one minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    const updated = { ...eligible, successfulInvites: 3, earnedDays: 21 };
    auth.authedRequest
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...updated, entitlement });

    const first = queueReferralSummaryRefresh("user-1");
    const repeated = Array.from({ length: 9 }, () => queueReferralSummaryRefresh("user-1"));

    expect(auth.authedRequest).toHaveBeenCalledOnce();
    await expect(Promise.all([first, ...repeated])).resolves.toEqual(Array(10).fill(snapshot));

    await vi.advanceTimersByTimeAsync(59_999);
    await expect(queueReferralSummaryRefresh("user-1")).resolves.toEqual(snapshot);
    expect(auth.authedRequest).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await expect(queueReferralSummaryRefresh("user-1")).resolves.toEqual({
      ...updated,
      entitlement,
    });
    expect(auth.authedRequest).toHaveBeenCalledTimes(2);
  });

  it("starts the full cooldown only after a slow request succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T15:00:00Z"));
    let finish!: (value: typeof snapshot) => void;
    auth.authedRequest
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValue(snapshot);
    const pending = queueReferralSummaryRefresh("slow-user");
    expect(auth.authedRequest).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    finish(snapshot);
    await pending;
    await vi.advanceTimersByTimeAsync(59_999);
    await queueReferralSummaryRefresh("slow-user");
    expect(auth.authedRequest).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await queueReferralSummaryRefresh("slow-user");
    expect(auth.authedRequest).toHaveBeenCalledTimes(2);
  });

  it("allows an immediate retry when a manual refresh fails", async () => {
    auth.authedRequest.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(snapshot);

    await expect(queueReferralSummaryRefresh("user-retry")).rejects.toThrow("offline");
    await expect(queueReferralSummaryRefresh("user-retry")).resolves.toEqual(snapshot);
    expect(auth.authedRequest).toHaveBeenCalledTimes(2);
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
