import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.hoisted(() => ({
  ensureReferralSummaryCached: vi.fn(),
  readCachedReferralSummary: vi.fn(),
  refreshReferralSummary: vi.fn(),
  queueReferralSummaryRefresh: vi.fn(),
  claimReferralCode: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("@/lib/api/referrals", async (original) => ({
  ...(await original<typeof import("@/lib/api/referrals")>()),
  ensureReferralSummaryCached: api.ensureReferralSummaryCached,
  readCachedReferralSummary: api.readCachedReferralSummary,
  refreshReferralSummary: api.refreshReferralSummary,
  queueReferralSummaryRefresh: api.queueReferralSummaryRefresh,
  claimReferralCode: api.claimReferralCode,
}));
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({
    db: { auth: { userId: "user-1" } },
    lang: "fa",
    t: (fa: string) => fa,
  }),
}));
vi.mock("sonner", () => ({ toast }));

import { Route } from "./referrals";

const Page = (Route as unknown as { component: () => React.ReactNode }).component;
const eligible = {
  referralCode: "OWNCOD",
  rewardDays: 7 as const,
  successfulInvites: 2,
  earnedDays: 14,
  claimState: { status: "eligible" as const },
};

describe("referrals page", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    api.readCachedReferralSummary.mockReset().mockReturnValue(null);
    api.ensureReferralSummaryCached.mockReset().mockResolvedValue(eligible);
    api.refreshReferralSummary.mockReset().mockResolvedValue(eligible);
    api.queueReferralSummaryRefresh.mockReset().mockResolvedValue(eligible);
    api.claimReferralCode.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<Page />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("loads once and renders the approved copy and metrics", () => {
    expect(api.ensureReferralSummaryCached).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("یک هفته هدیه با هر دعوت موفق");
    expect(host.textContent).toContain("تو و دوستت، هر کدام یک هفته رایگان.");
    expect(host.textContent).toContain("دوستت با کد تو ثبت‌نام کند و اولین اشتراکش را بخرد.");
    expect(host.textContent).toContain("OWNCOD");
    expect(host.textContent).toContain("۱۴");
  });

  it("renders cached data immediately without requesting the server", async () => {
    await act(async () => root.unmount());
    api.ensureReferralSummaryCached.mockClear();
    api.readCachedReferralSummary.mockReturnValue(eligible);
    host.textContent = "";
    root = createRoot(host);
    await act(async () => root.render(<Page />));

    expect(host.textContent).toContain("OWNCOD");
    expect(api.ensureReferralSummaryCached).not.toHaveBeenCalled();
  });

  it("keeps the page usable when the first request fails", async () => {
    await act(async () => root.unmount());
    api.ensureReferralSummaryCached.mockRejectedValue(new Error("offline"));
    host.textContent = "";
    root = createRoot(host);
    await act(async () => root.render(<Page />));

    expect(host.textContent).toContain("یک هفته هدیه با هر دعوت موفق");
    expect(host.textContent).toContain("با اولین اتصال");
    expect(host.textContent).toContain("دریافت کد");
  });

  it("keeps repeated refresh taps responsive while the request remains coalesced", async () => {
    let finishRefresh!: (summary: typeof eligible) => void;
    const queued = new Promise<typeof eligible>((resolve) => {
      finishRefresh = resolve;
    });
    api.queueReferralSummaryRefresh.mockReturnValue(queued);
    const refreshed = {
      ...eligible,
      successfulInvites: 3,
      earnedDays: 21,
    };
    const refresh = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("به‌روزرسانی آمار"),
    )! as HTMLButtonElement;

    expect(api.queueReferralSummaryRefresh).not.toHaveBeenCalled();
    await act(async () => refresh.click());
    expect(refresh.disabled).toBe(false);
    expect(refresh.textContent).toContain("در حال دریافت آمار");
    await act(async () => {
      for (let tap = 1; tap < 10; tap += 1) refresh.click();
    });

    expect(api.queueReferralSummaryRefresh).toHaveBeenCalledTimes(10);
    expect(api.queueReferralSummaryRefresh).toHaveBeenLastCalledWith("user-1");
    await act(async () => finishRefresh(refreshed));
    expect(host.textContent).toContain("۲۱");
  });

  it("keeps cached stats without showing an error when refresh fails", async () => {
    api.queueReferralSummaryRefresh.mockRejectedValue(new Error("offline"));
    const refresh = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("به‌روزرسانی آمار"),
    )!;

    await act(async () => refresh.click());

    expect(toast.error).not.toHaveBeenCalled();
    expect(host.textContent).toContain("۱۴");
  });

  it("does not explain hidden eligibility rules for older accounts", async () => {
    await act(async () => root.unmount());
    api.readCachedReferralSummary.mockReturnValue({
      ...eligible,
      claimState: { status: "ineligible", reason: "account_predates_program" },
    });
    host.textContent = "";
    root = createRoot(host);
    await act(async () => root.render(<Page />));

    expect(host.textContent).not.toContain("قبل از شروع این برنامه");
    expect(host.textContent).not.toContain("اطلاعات ذخیره‌شده روی دستگاه");
  });

  it("normalizes a claim and uses the POST response without refetching", async () => {
    api.claimReferralCode.mockResolvedValue({
      ...eligible,
      claimState: { status: "claimed" },
    });
    const input = host.querySelector('input[aria-label="کد دعوت دوست"]')! as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "ab-cdef");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = input.closest("form")!;
    await act(async () => form.requestSubmit());

    expect(api.claimReferralCode).toHaveBeenCalledWith("ABCDEF", "user-1");
    expect(api.ensureReferralSummaryCached).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("کد دعوتت ثبت شده");
  });
});
