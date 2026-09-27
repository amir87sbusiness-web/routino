import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const network = vi.hoisted(() => ({ authedRequest: vi.fn() }));
vi.mock("@/lib/api/auth", () => network);
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({
    db: { auth: { userId: "refresh-integration" } },
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
it("clicks the real page and API client immediately, renders rewarded status and animates cached taps without additional requests", async () => {
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
  cacheReferralSummary("refresh-integration", initial);
  network.authedRequest.mockResolvedValue(rewarded);
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
