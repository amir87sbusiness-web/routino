import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDb } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  accountDeletionAt: vi.fn<() => number | null>(),
  downloadBackup: vi.fn(() => true),
  copyBackupToClipboard: vi.fn(),
  isNative: vi.fn(() => false),
  shareBackupNative: vi.fn(),
  ctx: null as Record<string, unknown> | null,
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/lib/api/auth", () => ({ accountDeletionAt: mocks.accountDeletionAt }));
vi.mock("@/lib/backup", () => ({
  downloadBackup: mocks.downloadBackup,
  copyBackupToClipboard: mocks.copyBackupToClipboard,
}));
vi.mock("@/lib/backup-native", () => ({
  isNative: mocks.isNative,
  shareBackupNative: mocks.shareBackupNative,
}));
vi.mock("@/state/app", () => ({ useAppMaybe: () => mocks.ctx }));

import { AccountDeletionWarning } from "./AccountDeletionWarning";

describe("AccountDeletionWarning", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T12:00:00Z"));
    const db = defaultDb([]);
    db.auth = { userId: "trial-user", phone: "989123334444", verifiedAt: Date.now() };
    mocks.ctx = { db, t: (fa: string) => fa };
    mocks.navigate.mockReset();
    mocks.downloadBackup.mockReset().mockReturnValue(true);
    mocks.accountDeletionAt.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("opens on app boot only during the final three days and makes no request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    mocks.accountDeletionAt.mockReturnValue(Date.now() + 3 * 86_400_000);

    await act(async () => root.render(<AccountDeletionWarning />));

    expect(document.body.textContent).toContain("هشدار حذف اطلاعات");
    expect(document.body.textContent).toContain("گرفتن خروجی");
    expect(document.body.textContent).toContain("خرید اشتراک");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not open before the final three-day window", async () => {
    mocks.accountDeletionAt.mockReturnValue(Date.now() + 3 * 86_400_000 + 1);
    await act(async () => root.render(<AccountDeletionWarning />));
    expect(document.body.textContent).not.toContain("هشدار حذف اطلاعات");
  });

  it("exports locally or navigates to the existing purchase page", async () => {
    mocks.accountDeletionAt.mockReturnValue(Date.now() + 86_400_000);
    await act(async () => root.render(<AccountDeletionWarning />));

    const exportButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "گرفتن خروجی",
    )!;
    await act(async () => exportButton.click());
    expect(mocks.downloadBackup).toHaveBeenCalledTimes(1);

    await act(async () => root.render(<AccountDeletionWarning />));
    const buyButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "خرید اشتراک",
    )!;
    await act(async () => buyButton.click());
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/subscribe" });
  });
});
