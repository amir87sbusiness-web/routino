import { describe, expect, it } from "vitest";
import {
  advanceTimer,
  createTimer,
  loadTimer,
  pauseTimer,
  resumeTimer,
  saveTimer,
} from "./timer-runtime";

describe("timer runtime", () => {
  it("uses elapsed wall time after a tab sleeps instead of counting callbacks", () => {
    const started = resumeTimer(createTimer("free", 2), 1_000);
    const result = advanceTimer(started, 31_000);
    expect(result.state.remainingMs).toBe(90_000);
    expect(result.state.focusMs).toBe(30_000);
    expect(result.state.running).toBe(true);
  });

  it("pauses without counting time spent away", () => {
    const started = resumeTimer(createTimer("free", 2), 1_000);
    const paused = pauseTimer(started, 31_000);
    expect(advanceTimer(paused, 91_000).state.remainingMs).toBe(90_000);
    expect(advanceTimer(resumeTimer(paused, 91_000), 101_000).state.remainingMs).toBe(80_000);
  });

  it("crosses every pomodoro phase while the page is closed and credits focus once", () => {
    const timer = createTimer("pomodoro", 1, { breakMinutes: 1, cycles: 2 });
    const result = advanceTimer(resumeTimer(timer, 1_000), 181_000);
    expect(result.state.running).toBe(false);
    expect(result.state.finished).toBe(true);
    expect(result.state.pending.map((item) => item.focusSeconds)).toEqual([60, 60]);
    expect(result.state.pending.map((item) => item.endedAt)).toEqual([61_000, 181_000]);
    expect(advanceTimer(result.state, 241_000).state.pending).toHaveLength(2);
  });

  it("counts only active stopwatch time across a pause and a reload", () => {
    const started = resumeTimer(createTimer("stopwatch", 25), 1_000);
    const paused = pauseTimer(started, 31_000);
    const resumed = resumeTimer(JSON.parse(JSON.stringify(paused)), 91_000);
    expect(advanceTimer(resumed, 101_000).state.elapsedMs).toBe(40_000);
  });

  it("does not move backwards if the device clock is corrected backwards", () => {
    const started = resumeTimer(createTimer("free", 2), 10_000);
    expect(advanceTimer(started, 9_000).state.remainingMs).toBe(120_000);
    expect(advanceTimer(advanceTimer(started, 9_000).state, 19_000).state.remainingMs).toBe(
      110_000,
    );
  });

  it("restores a running timer after the page is recreated", () => {
    const owner = "timer-test-restore";
    saveTimer(owner, resumeTimer(createTimer("free", 2), 1_000));
    expect(advanceTimer(loadTimer(owner), 31_000).state.remainingMs).toBe(90_000);
    localStorage.removeItem(`routino:active-timer:v1:${owner}`);
  });

  it("rejects an impossible running timer instead of leaving it stuck", () => {
    const owner = "timer-test-invalid";
    const value = resumeTimer(createTimer("free", 2), 1_000);
    localStorage.setItem(
      `routino:active-timer:v1:${owner}`,
      JSON.stringify({ ...value, remainingMs: 0 }),
    );
    expect(loadTimer(owner).running).toBe(false);
    localStorage.removeItem(`routino:active-timer:v1:${owner}`);
  });
});
