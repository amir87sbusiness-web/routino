import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferralSummary } from "@/lib/api/referrals";
import { ReferralSettingsCard } from "./ReferralSettingsCard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const summary: ReferralSummary = {
  referralCode: "ABCDEF",
  rewardDays: 7,
  successfulInvites: 3,
  earnedDays: 21,
  claimState: { status: "eligible" },
};

describe("ReferralSettingsCard", () => {
  let host: HTMLDivElement;
  let root: Root;
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    writeText.mockClear();
  });

  it("shows the server summary and copies the stable code without an API request", async () => {
    await act(async () => {
      root.render(<ReferralSettingsCard summary={summary} lang="fa" t={(fa) => fa} />);
    });

    expect(host.textContent).toContain("ABCDEF");
    expect(host.textContent).toContain("۳");
    expect(host.textContent).toContain("۲۱");
    expect(host.textContent).toContain(
      "بعد از اولین خرید موفق دوستت، هر دوی شما ۷ روز اشتراک هدیه می‌گیرید.",
    );

    const copy = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("کپی"),
    )!;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith("ABCDEF");
  });
});
