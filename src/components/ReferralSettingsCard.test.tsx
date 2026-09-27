import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferralSettingsCard } from "./ReferralSettingsCard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: React.ComponentProps<"a"> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

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

  it("opens the full referral page without exposing stats in Settings", async () => {
    await act(async () => root.render(<ReferralSettingsCard t={(fa) => fa} />));
    expect(host.textContent).toBe("دعوت دوستان");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/referrals");
    expect(host.querySelector("button")).toBeNull();
  });
});
