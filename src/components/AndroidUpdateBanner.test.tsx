import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const updates = vi.hoisted(() => ({
  check: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@/lib/android-update", () => ({
  checkAndroidUpdateOnBoot: updates.check,
  openAndroidUpdatePage: updates.open,
}));

import { AndroidUpdateBanner } from "./AndroidUpdateBanner";

describe("AndroidUpdateBanner", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    updates.check.mockReset();
    updates.open.mockReset();
    updates.check.mockResolvedValue({ versionCode: 10 });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("shows an Android-only in-app update card and opens the fixed download page", async () => {
    await act(async () => root.render(<AndroidUpdateBanner />));

    expect(host.textContent).toContain("نسخهٔ جدید روتینو آماده است");
    const update = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("بروزرسانی"),
    )!;
    await act(async () => update.click());

    expect(updates.open).toHaveBeenCalledTimes(1);
  });

  it("does not render when the local Android version is current", async () => {
    updates.check.mockResolvedValue(null);
    await act(async () => root.render(<AndroidUpdateBanner />));

    expect(host.textContent).not.toContain("نسخهٔ جدید روتینو آماده است");
  });
});
