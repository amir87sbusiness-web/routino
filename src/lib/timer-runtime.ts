import { uid, type TimerMode } from "./store";

export type TimerLink = { kind: "habit" | "task"; id: string; label: string } | null;

export interface TimerCompletion {
  id: string;
  mode: TimerMode;
  focusSeconds: number;
  startedAt: number;
  endedAt: number;
  linked: TimerLink;
}

/** Only the active timer lives here. Completed sessions still use the existing app data. */
export interface TimerState {
  version: 1;
  runId: string;
  mode: TimerMode;
  focusMinutes: number;
  breakMinutes: number;
  cycles: number;
  round: number;
  onBreak: boolean;
  freeMinutes: number;
  linked: TimerLink;
  remainingMs: number;
  elapsedMs: number;
  focusMs: number;
  sessionStartedAt: number | null;
  anchorAt: number | null;
  running: boolean;
  finished: boolean;
  pending: TimerCompletion[];
}

export type TimerTransition = "focus-ended" | "break-ended" | "finished";

export function createTimer(
  mode: TimerMode = "pomodoro",
  minutes = 25,
  options: {
    breakMinutes?: number;
    cycles?: number;
    freeMinutes?: number;
    linked?: TimerLink;
  } = {},
): TimerState {
  return {
    version: 1,
    runId: uid(),
    mode,
    focusMinutes: mode === "pomodoro" ? minutes : 25,
    breakMinutes: options.breakMinutes ?? 5,
    cycles: options.cycles ?? 4,
    round: 1,
    onBreak: false,
    freeMinutes: mode === "free" ? minutes : (options.freeMinutes ?? 25),
    linked: options.linked ?? null,
    remainingMs: minutes * 60_000,
    elapsedMs: 0,
    focusMs: 0,
    sessionStartedAt: null,
    anchorAt: null,
    running: false,
    finished: false,
    pending: [],
  };
}

export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.running || (state.finished && state.mode !== "stopwatch")) return state;
  return {
    ...state,
    running: true,
    finished: false,
    anchorAt: now,
    sessionStartedAt: state.sessionStartedAt ?? now,
  };
}

export function advanceTimer(
  input: TimerState,
  now: number,
): { state: TimerState; transitions: TimerTransition[] } {
  if (!input.running || input.anchorAt === null) return { state: input, transitions: [] };
  if (now < input.anchorAt) {
    return { state: { ...input, anchorAt: now }, transitions: [] };
  }
  const elapsed = Math.max(0, now - input.anchorAt);
  if (elapsed === 0) return { state: input, transitions: [] };
  let state = { ...input, pending: [...input.pending] };
  const transitions: TimerTransition[] = [];

  if (state.mode === "stopwatch") {
    state.elapsedMs += elapsed;
    state.focusMs += elapsed;
    state.anchorAt = now;
    return { state, transitions };
  }

  let left = elapsed;
  let phaseEnd = input.anchorAt;
  while (left >= state.remainingMs && state.running && state.remainingMs > 0) {
    const spent = state.remainingMs;
    phaseEnd += spent;
    left -= spent;
    if (state.mode === "free" || !state.onBreak) {
      state.focusMs += spent;
      const focusSeconds = Math.round(state.focusMs / 1000);
      if (focusSeconds > 0) {
        state.pending.push({
          id: `${state.runId}:${state.mode === "free" ? "free" : state.round}`,
          mode: state.mode,
          focusSeconds,
          startedAt: state.sessionStartedAt ?? phaseEnd - state.focusMs,
          endedAt: phaseEnd,
          linked: state.linked,
        });
      }
      state.focusMs = 0;
      state.sessionStartedAt = null;
    }

    if (state.mode === "free") {
      state = { ...state, remainingMs: 0, running: false, finished: true, anchorAt: null };
      transitions.push("finished");
    } else if (!state.onBreak) {
      if (state.round >= state.cycles) {
        state = {
          ...state,
          round: 1,
          onBreak: false,
          remainingMs: state.focusMinutes * 60_000,
          running: false,
          finished: true,
          anchorAt: null,
        };
        transitions.push("finished");
      } else {
        state = { ...state, onBreak: true, remainingMs: state.breakMinutes * 60_000 };
        transitions.push("focus-ended");
      }
    } else {
      state = {
        ...state,
        round: state.round + 1,
        onBreak: false,
        remainingMs: state.focusMinutes * 60_000,
        sessionStartedAt: phaseEnd,
      };
      transitions.push("break-ended");
    }
  }
  if (state.running) {
    state.remainingMs -= left;
    if (state.mode === "free" || !state.onBreak) state.focusMs += left;
    state.anchorAt = now;
  }
  return { state, transitions };
}

export function pauseTimer(state: TimerState, now: number): TimerState {
  const advanced = advanceTimer(state, now).state;
  return { ...advanced, running: false, anchorAt: null };
}

const STORAGE_PREFIX = "routino:active-timer:v1:";
export const TIMER_UPDATED_EVENT = "routino:active-timer-updated";

export interface TimerUpdatedDetail {
  owner: string;
  state: TimerState;
}

export function loadTimer(owner: string): TimerState {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${owner}`);
    if (!raw) return createTimer();
    const value = JSON.parse(raw) as TimerState;
    if (
      value.version !== 1 ||
      !["pomodoro", "free", "stopwatch"].includes(value.mode) ||
      !Number.isFinite(value.remainingMs) ||
      value.remainingMs < 0 ||
      (value.running && value.mode !== "stopwatch" && value.remainingMs === 0) ||
      !Number.isFinite(value.focusMs) ||
      !Array.isArray(value.pending) ||
      !Number.isFinite(value.focusMinutes) ||
      value.focusMinutes <= 0 ||
      !Number.isFinite(value.breakMinutes) ||
      value.breakMinutes <= 0 ||
      !Number.isFinite(value.cycles) ||
      value.cycles < 1 ||
      !Number.isFinite(value.round) ||
      value.round < 1 ||
      value.round > value.cycles ||
      (value.running && !Number.isFinite(value.anchorAt))
    )
      return createTimer();
    return value;
  } catch {
    return createTimer();
  }
}

export function saveTimer(owner: string, state: TimerState): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${owner}`, JSON.stringify(state));
    window.dispatchEvent(
      new CustomEvent<TimerUpdatedDetail>(TIMER_UPDATED_EVENT, { detail: { owner, state } }),
    );
  } catch {
    // The in-memory timer still works if private browsing denies storage.
  }
}
