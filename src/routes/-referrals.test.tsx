import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.hoisted(() => ({ fetchReferralSummary: vi.fn(), claimReferralCode: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("@/lib/api/referrals", async (original) => ({
  ...(await original<typeof import("@/lib/api/referrals")>()),
  fetchReferralSummary: api.fetchReferralSummary,
  claimReferralCode: api.claimReferralCode,
}));
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({
    db: { auth: { userId: "user-1" } },
    lang: "fa",
    t: (fa: string) => fa,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
    api.fetchReferralSummary.mockReset().mockResolvedValue(eligible);
    api.claimReferralCode.mockReset();
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
    expect(api.fetchReferralSummary).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("یک هفته هدیه برای هر دعوت موفق");
    expect(host.textContent).toContain(
      "هر دعوت موفق به روتینو، یک هفته استفاده رایگان برای تو و دوستت.",
    );
    expect(host.textContent).toContain(
      "دعوتی موفق است که دوستت با کد تو ثبت‌نام کند و اولین اشتراک خود را بخرد.",
    );
    expect(host.textContent).toContain("OWNCOD");
    expect(host.textContent).toContain("۱۴");
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
    expect(api.fetchReferralSummary).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("کد دعوتت ثبت شده");
  });
});
