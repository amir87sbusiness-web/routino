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
  localNotify: vi.fn(async () => "shown"),
  android: true,
  ctx: null as any,
}));

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/habits", () => ({
  CelebrationModal: () => null,
  useCelebration: () => ({ celebration: null, clear: vi.fn() }),
}));
vi.mock("@/lib/android-timer-notification", () => ({
  isAndroidNativeTimer: () => mocks.android,
  syncAndroidTimer: mocks.sync,
  consumeAndroidTimerCommand: mocks.consume,
  openAndroidNotificationSettings: mocks.openSettings,
}));
vi.mock("@/lib/local-web-notifications", () => ({
  showLocalWebNotification: mocks.localNotify,
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
    mocks.localNotify.mockReset().mockResolvedValue("shown");
    mocks.android = true;
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

  it("announces a web timer completion once through the shared local notification path", async () => {
    mocks.android = false;
    const active = resumeTimer(createTimer("free", 1), 1_000);
    saveTimer("user-1", active);

    await act(async () => root.render(<TimerPage />));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));

    expect(mocks.localNotify).toHaveBeenCalledTimes(1);
    expect(mocks.localNotify).toHaveBeenCalledWith({
      id: `user-1|timer|${active.runId}|finished`,
      title: "Routino",
      body: "⏰ تایمر تمام شد!",
    });
  });

  it("announces a completion discovered when the PWA returns from suspension", async () => {
    mocks.android = false;
    const active = resumeTimer(createTimer("free", 1), 1_000);
    saveTimer("user-1", active);
    await act(async () => root.render(<TimerPage />));

    vi.setSystemTime(61_000);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));

    expect(mocks.localNotify).toHaveBeenCalledWith(
      expect.objectContaining({ id: `user-1|timer|${active.runId}|finished` }),
    );
  });

  it("announces the latest relevant transition after a multi-phase suspension", async () => {
    mocks.android = false;
    const active = resumeTimer(
      createTimer("pomodoro", 1, { breakMinutes: 1, cycles: 2 }),
      1_000,
    );
    saveTimer("user-1", active);
    await act(async () => root.render(<TimerPage />));

    vi.setSystemTime(181_000);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));

    expect(mocks.localNotify).toHaveBeenCalledTimes(1);
    expect(mocks.localNotify).toHaveBeenCalledWith({
      id: `user-1|timer|${active.runId}|finished`,
      title: "Routino",
      body: "🎉 همه‌ی دورها تموم شد! آفرین.",
    });
  });

  it("announces an elapsed timer when mounting the timer route directly", async () => {
    mocks.android = false;
    const active = resumeTimer(createTimer("free", 1), 1_000);
    saveTimer("user-1", active);
    vi.setSystemTime(61_000);

    await act(async () => root.render(<TimerPage />));

    expect(mocks.localNotify).toHaveBeenCalledTimes(1);
    expect(mocks.localNotify).toHaveBeenCalledWith(
      expect.objectContaining({ id: `user-1|timer|${active.runId}|finished` }),
    );
  });
});
