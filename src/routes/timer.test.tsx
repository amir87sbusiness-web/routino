import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDb, type Db } from "@/lib/store";
import { createTimer, loadTimer, resumeTimer, saveTimer } from "@/lib/timer-runtime";

const mocks = vi.hoisted(() => ({
  sync: vi.fn<(timer: any) => Promise<void>>(async () => undefined),
  consume: vi.fn<() => Promise<any>>(async () => null),
  openSettings: vi.fn(async () => undefined),
  checkPermission: vi.fn(async () => "granted"),
  requestPermission: vi.fn(async () => true),
  ctx: null as any,
}));

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/habits", () => ({
  CelebrationModal: () => null,
  useCelebration: () => ({ celebration: null, clear: vi.fn() }),
}));
vi.mock("@/lib/android-timer-notification", () => ({
  isAndroidNativeTimer: () => true,
  syncAndroidTimer: mocks.sync,
  consumeAndroidTimerCommand: mocks.consume,
  openAndroidNotificationSettings: mocks.openSettings,
}));
vi.mock("@/lib/native-notifications", () => ({
  checkNativeNotificationPermission: mocks.checkPermission,
  requestNativePermission: mocks.requestPermission,
}));
vi.mock("@/state/app", () => ({ useAppMaybe: () => mocks.ctx }));

import { TimerPage } from "./timer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("TimerPage native timer integration", () => {
  let host: HTMLDivElement;
  let root: Root;
  let db: Db;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    localStorage.clear();
    db = defaultDb([]);
    db.auth = { userId: "user-1", phone: "09120000000", verifiedAt: 1_000 };
    mocks.ctx = {
      db,
      cal: "gregorian",
      lang: "fa",
      t: (fa: string) => fa,
      requestProductWrite: () => true,
      update: (fn: (value: Db) => Db) => {
        db = fn(db);
        mocks.ctx.db = db;
        return true;
      },
    };
    mocks.sync.mockClear();
    mocks.consume.mockReset().mockResolvedValue(null);
    mocks.openSettings.mockClear();
    mocks.checkPermission.mockReset().mockResolvedValue("granted");
    mocks.requestPermission.mockReset().mockResolvedValue(true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("starts the native service immediately before any notification permission prompt", async () => {
    mocks.checkPermission.mockResolvedValue("prompt");
    await act(async () => root.render(<TimerPage />));

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="شروع"]')!.click());

    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ running: true }));
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it("requests a prompt permission from the explicit CTA", async () => {
    mocks.checkPermission.mockResolvedValue("prompt");
    await act(async () => root.render(<TimerPage />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="شروع"]')!.click());

    const cta = [...host.querySelectorAll("button")].find((button) => button.textContent === "فعال‌کردن اعلان")!;
    await act(async () => cta.click());
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("opens Android notification settings from the CTA after denial", async () => {
    mocks.checkPermission.mockResolvedValue("denied");
    await act(async () => root.render(<TimerPage />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="شروع"]')!.click());

    const cta = [...host.querySelectorAll("button")].find((button) => button.textContent === "فعال‌کردن اعلان")!;
    await act(async () => cta.click());
    expect(mocks.openSettings).toHaveBeenCalledTimes(1);
  });

  it("rechecks a stale denied CTA permission and requests it when Android can still prompt", async () => {
    mocks.checkPermission
      .mockResolvedValueOnce("denied")
      .mockResolvedValueOnce("denied")
      .mockResolvedValueOnce("prompt");
    await act(async () => root.render(<TimerPage />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="شروع"]')!.click());

    const cta = [...host.querySelectorAll("button")].find((button) => button.textContent === "فعال‌کردن اعلان")!;
    await act(async () => cta.click());

    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
    expect(mocks.openSettings).not.toHaveBeenCalled();
  });

  it("consumes a pause action once and keeps the timer session", async () => {
    saveTimer("user-1", resumeTimer(createTimer("free", 5), 1_000));
    mocks.consume.mockResolvedValue({ id: "pause-1", action: "pause", actedAt: 2_000 });

    await act(async () => root.render(<TimerPage />));

    expect(loadTimer("user-1").running).toBe(false);
    // Foreground listeners may poll more than once, but the command id must
    // never apply more than once.
    expect(mocks.sync.mock.calls.filter(([timer]) => timer.running === false)).toHaveLength(1);
  });
});
