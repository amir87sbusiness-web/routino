import { Capacitor, registerPlugin } from "@capacitor/core";
import type { TimerState } from "./timer-runtime";

interface TimerNotificationBridge {
  sync(options: { timer: NativeTimerSnapshot }): Promise<void>;
  /** Atomically removes the notification action before returning it. */
  getPendingCommand(): Promise<AndroidTimerCommand | null>;
  /** Opens the app-specific Android notification settings screen. */
  openNotificationSettings(): Promise<void>;
}

export interface AndroidTimerCommand {
  id: string;
  action: "pause" | "resume" | "finish" | "cancel";
  /** Native action time and latest native timeline, when the bridge can provide them. */
  actedAt?: number;
  timer?: NativeTimerSnapshot;
}

export interface NativeTimerSnapshot {
  active?: boolean;
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
const consumedCommandIds = new Set<string>();

export function isAndroidNativeTimer(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/** Preserve Start/Pause order across asynchronous Capacitor calls. */
export function syncAndroidTimer(state: TimerState): Promise<void> {
  if (!isAndroidNativeTimer()) return Promise.resolve();
  const timer: NativeTimerSnapshot = {
    active:
      state.running ||
      state.onBreak ||
      state.sessionStartedAt !== null ||
      state.focusMs > 0 ||
      state.elapsedMs > 0,
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

/**
 * Native clears the stored action before resolving. The id guard is defensive:
 * a resumed WebView must never apply the same command twice if a plugin retries.
 */
export async function consumeAndroidTimerCommand(): Promise<AndroidTimerCommand | null> {
  if (!isAndroidNativeTimer()) return null;
  const command = await bridge.getPendingCommand();
  if (
    !command ||
    typeof command.id !== "string" ||
    !["pause", "resume", "finish", "cancel"].includes(command.action) ||
    consumedCommandIds.has(command.id)
  )
    return null;
  consumedCommandIds.add(command.id);
  return command;
}

/** Make the native foreground service authoritative after notification actions. */
export function reconcileAndroidTimerSnapshot(
  local: TimerState,
  native: NativeTimerSnapshot | undefined,
): TimerState {
  if (!native || native.mode !== local.mode) return local;
  const focusMs =
    native.mode === "stopwatch"
      ? native.elapsedMs
      : native.onBreak
        ? 0
        : Math.max(
            0,
            (native.mode === "free" ? local.freeMinutes : native.focusMinutes) * 60_000 -
              native.remainingMs,
          );
  return {
    ...local,
    remainingMs: native.remainingMs,
    elapsedMs: native.elapsedMs,
    focusMinutes: native.focusMinutes,
    breakMinutes: native.breakMinutes,
    cycles: native.cycles,
    round: native.round,
    onBreak: native.onBreak,
    focusMs,
    anchorAt: native.anchorAt,
    running: native.running,
    finished: false,
  };
}

export async function openAndroidNotificationSettings(): Promise<void> {
  if (!isAndroidNativeTimer()) return;
  await bridge.openNotificationSettings();
}
