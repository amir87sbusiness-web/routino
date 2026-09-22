import { beforeEach, describe, expect, it, vi } from "vitest";

const { bridge, runtime } = vi.hoisted(() => ({
  bridge: {
    sync: vi.fn(async () => undefined),
    getPendingCommand: vi.fn(),
    openNotificationSettings: vi.fn(async () => undefined),
  },
  runtime: { native: true, platform: "android" },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => runtime.native,
    getPlatform: () => runtime.platform,
  },
  registerPlugin: () => bridge,
}));

import {
  consumeAndroidTimerCommand,
  openAndroidNotificationSettings,
  reconcileAndroidTimerSnapshot,
  syncAndroidTimer,
} from "./android-timer-notification";
import { createTimer, resumeTimer } from "./timer-runtime";

describe("android timer notification bridge", () => {
  beforeEach(() => {
    runtime.native = true;
    runtime.platform = "android";
    bridge.sync.mockClear();
    bridge.openNotificationSettings.mockClear();
    bridge.getPendingCommand.mockReset();
  });

  it("immediately sends the running snapshot to the native foreground service", async () => {
    const running = resumeTimer(createTimer("free", 25), 1_000);

    await syncAndroidTimer(running);

    expect(bridge.sync).toHaveBeenCalledWith(
      expect.objectContaining({ timer: expect.objectContaining({ running: true, anchorAt: 1_000 }) }),
    );
  });

  it("keeps a paused active session in the native notification for resume", async () => {
    const running = resumeTimer(createTimer("free", 25), 1_000);

    await syncAndroidTimer({
      ...running,
      running: false,
      anchorAt: null,
      focusMs: 30_000,
    });

    expect(bridge.sync).toHaveBeenCalledWith(
      expect.objectContaining({ timer: expect.objectContaining({ active: true, running: false }) }),
    );
  });

  it("returns each native notification command only once", async () => {
    bridge.getPendingCommand.mockResolvedValue({ id: "notification-7", action: "pause" });

    await expect(consumeAndroidTimerCommand()).resolves.toEqual({
      id: "notification-7",
      action: "pause",
    });
    await expect(consumeAndroidTimerCommand()).resolves.toBeNull();
  });

  it("accepts the resume action emitted by the paused notification", async () => {
    bridge.getPendingCommand.mockResolvedValue({ id: "notification-resume", action: "resume" });

    await expect(consumeAndroidTimerCommand()).resolves.toEqual({
      id: "notification-resume",
      action: "resume",
    });
  });

  it("reconciles the latest native paused snapshot without counting paused time", () => {
    const local = resumeTimer(createTimer("free", 25), 1_000);

    const reconciled = reconcileAndroidTimerSnapshot(local, {
      mode: "free",
      remainingMs: 1_200_000,
      elapsedMs: 0,
      focusMinutes: 25,
      breakMinutes: 5,
      cycles: 1,
      round: 1,
      onBreak: false,
      anchorAt: null,
      running: false,
    });

    expect(reconciled).toMatchObject({
      running: false,
      anchorAt: null,
      remainingMs: 1_200_000,
      focusMs: 300_000,
    });
  });

  it("opens Android notification settings only on Android", async () => {
    await openAndroidNotificationSettings();
    expect(bridge.openNotificationSettings).toHaveBeenCalledTimes(1);

    runtime.platform = "web";
    await openAndroidNotificationSettings();
    expect(bridge.openNotificationSettings).toHaveBeenCalledTimes(1);
  });
});
