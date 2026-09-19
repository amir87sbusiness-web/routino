import { Capacitor, registerPlugin } from "@capacitor/core";
import type { TimerState } from "./timer-runtime";

interface TimerNotificationBridge {
  sync(options: { timer: NativeTimerSnapshot }): Promise<void>;
}

interface NativeTimerSnapshot {
  mode: TimerState["mode"];
  remainingMs: number;
  elapsedMs: number;
  focusMinutes: number;
  breakMinutes: number;
  cycles: number;
  round: number;
  onBreak: boolean;
  anchorAt: number | null;
  running: boolean;
}

const bridge = registerPlugin<TimerNotificationBridge>("TimerNotification");
let queue: Promise<void> = Promise.resolve();

export function isAndroidNativeTimer(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/** Preserve Start/Pause order across asynchronous Capacitor calls. */
export function syncAndroidTimer(state: TimerState): Promise<void> {
  if (!isAndroidNativeTimer()) return Promise.resolve();
  const timer: NativeTimerSnapshot = {
    mode: state.mode,
    remainingMs: state.remainingMs,
    elapsedMs: state.elapsedMs,
    focusMinutes: state.focusMinutes,
    breakMinutes: state.breakMinutes,
    cycles: state.cycles,
    round: state.round,
    onBreak: state.onBreak,
    anchorAt: state.anchorAt,
    running: state.running,
  };
  queue = queue.catch(() => {}).then(() => bridge.sync({ timer }));
  return queue;
}
