import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const network = vi.hoisted(() => ({
  authedRequest: vi.fn(),
  markEntitlementChecked: vi.fn(),
}));
const app = vi.hoisted(() => ({ applyEntitlement: vi.fn() }));
vi.mock("@/lib/api/auth", async (original) => ({
  ...(await original<typeof import("@/lib/api/auth")>()),
  authedRequest: network.authedRequest,
  markEntitlementChecked: network.markEntitlementChecked,
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({
    db: { auth: { userId: "refresh-integration" } },
    applyEntitlement: app.applyEntitlement,
    lang: "fa",
    t: (fa: string) => fa,
  }),
}));
import { Route } from "./referrals";
import { cacheReferralSummary } from "@/lib/api/referrals";
const Page = (Route as unknown as { component: () => React.ReactNode }).component;
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});
it("updates referral stats and Android local subscription from one refresh request", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
  const initial = {
    referralCode: "ABCDEF",
    rewardDays: 7 as const,
    successfulInvites: 0,
    earnedDays: 0,
    claimState: { status: "claimed" as const },
  };
  const rewarded = {
    ...initial,
    earnedDays: 7,
    claimState: { status: "claimed" as const, rewarded: true },
  };
  const entitlement = {
    status: "active" as const,
    planId: "m3",
    startedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-12-08T00:00:00.000Z",
    issuedAt: "2026-09-27T12:00:00.000Z",
    deletionAt: null,
  };
  const localSubscription = {
    planId: "m3",
    startedAt: Date.parse(entitlement.startedAt),
    expiresAt: Date.parse(entitlement.expiresAt),
    trial: false,
  };
  cacheReferralSummary("refresh-integration", initial);
  network.authedRequest.mockResolvedValue({ ...rewarded, entitlement });
  app.applyEntitlement.mockReset();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Page />));
    expect(network.authedRequest).not.toHaveBeenCalled();
    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("به‌روزرسانی آمار"),
    )!;
    await act(async () => button.click());
    expect(network.authedRequest).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("۷ روز هدیه گرفتی");
    expect(network.markEntitlementChecked).toHaveBeenCalledWith(entitlement);
    expect(app.applyEntitlement).toHaveBeenCalledOnce();
    expect(app.applyEntitlement).toHaveBeenCalledWith(localSubscription);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => button.click());
    expect(button.disabled).toBe(false);
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    for (let n = 0; n < 9; n++) await act(async () => button.click());
    expect(network.authedRequest).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(59_500));
    expect(network.authedRequest).toHaveBeenCalledTimes(1);
    await act(async () => button.click());
    expect(network.authedRequest).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
