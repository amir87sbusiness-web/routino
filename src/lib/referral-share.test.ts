import { beforeEach, describe, expect, it, vi } from "vitest";

const capacitor = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => false) }));
vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));

import { shareReferralCode } from "./referral-share";

describe("referral sharing", () => {
  const share = vi.fn();
  const writeText = vi.fn();

  beforeEach(() => {
    capacitor.isNativePlatform.mockReturnValue(false);
    share.mockReset();
    writeText.mockReset();
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("uses Web Share without touching the clipboard", async () => {
    share.mockResolvedValue(undefined);
    await expect(shareReferralCode("ABCDEF", "Join")).resolves.toBe("shared");
    expect(share).toHaveBeenCalledOnce();
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: "https://routino.me" }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("uses the clipboard when Web Share is unavailable", async () => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    writeText.mockResolvedValue(undefined);
    await expect(shareReferralCode("ABCDEF", "Join")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("Join\nABCDEF\nhttps://routino.me");
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("/app"));
  });

  it("does not fall back after the user cancels sharing", async () => {
    share.mockRejectedValue(new DOMException("Canceled", "AbortError"));
    await expect(shareReferralCode("ABCDEF", "Join")).resolves.toBe("canceled");
    expect(writeText).not.toHaveBeenCalled();
  });
});
