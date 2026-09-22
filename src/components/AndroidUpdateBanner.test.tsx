import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const updates = vi.hoisted(() => ({
  check: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/lib/android-update", () => ({
  checkAndroidUpdateOnBoot: updates.check,
  downloadAndroidUpdate: updates.download,
}));

import { AndroidUpdateBanner } from "./AndroidUpdateBanner";

describe("AndroidUpdateBanner", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    updates.check.mockReset();
    updates.download.mockReset();
    updates.download.mockResolvedValue(undefined);
    updates.check.mockResolvedValue({ versionCode: 10 });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("starts the APK download directly without opening the website download section", async () => {
    await act(async () => root.render(<AndroidUpdateBanner />));

    expect(host.textContent).toContain("نسخهٔ جدید روتینو آماده است");
    const update = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("بروزرسانی"),
    )!;
    await act(async () => update.click());

    expect(updates.download).toHaveBeenCalledTimes(1);
  });

  it("does not render when the local Android version is current", async () => {
    updates.check.mockResolvedValue(null);
    await act(async () => root.render(<AndroidUpdateBanner />));

    expect(host.textContent).not.toContain("نسخهٔ جدید روتینو آماده است");
  });

  it("keeps the update action visible until the user updates", async () => {
    await act(async () => root.render(<AndroidUpdateBanner />));
    expect(host.textContent).toContain("نسخهٔ جدید روتینو آماده است");
    expect(host.querySelector('[aria-label="فعلاً نه"]')).toBeNull();
  });
});
