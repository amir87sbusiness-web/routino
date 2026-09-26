import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultOnboardingDraft, saveOnboardingDraft } from "@/lib/onboarding";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const referrals = vi.hoisted(() => ({ claimReferralCode: vi.fn() }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
}));
vi.mock("@/components/OnboardingFlow", () => ({
  PersonalizationFlow: () => <div>personalization</div>,
}));
vi.mock("@/lib/api/referrals", async (original) => ({
  ...(await original<typeof import("@/lib/api/referrals")>()),
  claimReferralCode: referrals.claimReferralCode,
}));
vi.mock("@/lib/api/auth", () => ({
  startTrial: vi.fn(),
  entitlementToSubscription: vi.fn(),
}));
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({
    db: { auth: { userId: "user-1" }, subscription: null },
    lang: "fa",
    t: (fa: string) => fa,
    update: vi.fn(),
    applyEntitlement: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { Route } from "./getting-started";

const Page = (Route as unknown as { component: () => React.ReactNode }).component;

describe("getting-started referral prompt", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    saveOnboardingDraft(defaultOnboardingDraft("user-1"));
    referrals.claimReferralCode
      .mockReset()
      .mockResolvedValue({ claimState: { status: "claimed" } });
    navigate.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("skips without a server request and continues personalization", async () => {
    await act(async () => root.render(<Page />));
    const skip = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "فعلاً رد می‌کنم",
    )!;
    await act(async () => skip.click());
    expect(referrals.claimReferralCode).not.toHaveBeenCalled();
    expect(host.textContent).toContain("personalization");
  });

  it("submits exactly once and continues after a successful claim", async () => {
    await act(async () => root.render(<Page />));
    const input = host.querySelector('input[aria-label="کد دعوت"]')! as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "ab-cdef");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = input.closest("form")!;
    await act(async () => form.requestSubmit());
    expect(referrals.claimReferralCode).toHaveBeenCalledTimes(1);
    expect(referrals.claimReferralCode).toHaveBeenCalledWith("ABCDEF", "user-1");
    expect(host.textContent).toContain("personalization");
  });
});
