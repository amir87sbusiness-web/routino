import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ authedRequest: vi.fn() }));
vi.mock("./auth", () => auth);

import { claimReferralCode, fetchReferralSummary, normalizeReferralCode } from "./referrals";

describe("referrals API", () => {
  beforeEach(() => auth.authedRequest.mockReset());

  it("normalizes referral input to six uppercase ASCII letters", () => {
    expect(normalizeReferralCode(" ab-12cDefg ")).toBe("ABCDEF");
  });

  it("loads the summary with one authenticated request", async () => {
    auth.authedRequest.mockResolvedValue({ referralCode: "ABCDEF" });
    await fetchReferralSummary("user-1");
    expect(auth.authedRequest).toHaveBeenCalledOnce();
    expect(auth.authedRequest).toHaveBeenCalledWith("/referrals/me", {
      expectedUserId: "user-1",
    });
  });

  it("claims with one POST and returns that response without another GET", async () => {
    auth.authedRequest.mockResolvedValue({
      referralCode: "OWNCOD",
      claimState: { status: "claimed" },
    });
    await claimReferralCode(" ab-cdef ", "user-1");
    expect(auth.authedRequest).toHaveBeenCalledOnce();
    expect(auth.authedRequest).toHaveBeenCalledWith("/referrals/claim", {
      method: "POST",
      body: { code: "ABCDEF" },
      expectedUserId: "user-1",
    });
  });
});
