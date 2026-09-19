import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimer, loadTimer, resumeTimer, saveTimer } from "@/lib/timer-runtime";
import { ActiveTimerBar } from "./ActiveTimerBar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("ActiveTimerBar", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("keeps a running timer visible and advances it outside the timer route", async () => {
    saveTimer("user-1", resumeTimer(createTimer("free", 2), 1_000));
    await act(async () =>
      root.render(<ActiveTimerBar owner="user-1" lang="en" t={(fa) => fa} onOpen={vi.fn()} />),
    );

    expect(host.textContent).toContain("02:00");
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(host.textContent).toContain("01:30");
  });

  it("pauses without losing the session and opens the full timer", async () => {
    const onOpen = vi.fn();
    saveTimer("user-1", resumeTimer(createTimer("free", 2), 1_000));
    await act(async () =>
      root.render(<ActiveTimerBar owner="user-1" lang="en" t={(fa) => fa} onOpen={onOpen} />),
    );

    const pause = host.querySelector<HTMLButtonElement>('button[aria-label="مکث"]')!;
    await act(async () => pause.click());
    expect(loadTimer("user-1").running).toBe(false);
    expect(host.textContent).toContain("02:00");

    const bar = host.querySelector<HTMLButtonElement>('button[aria-label="باز کردن تایمر"]')!;
    await act(async () => bar.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("reacts immediately when the timer starts in the same browser tab", async () => {
    await act(async () =>
      root.render(<ActiveTimerBar owner="user-1" lang="en" t={(fa) => fa} onOpen={vi.fn()} />),
    );
    expect(host.textContent).toBe("");

    await act(async () => saveTimer("user-1", resumeTimer(createTimer("free", 1), 1_000)));
    expect(host.textContent).toContain("01:00");
  });

  it("does not resume a paused timer when product writes are blocked", async () => {
    const paused = resumeTimer(createTimer("free", 2), 1_000);
    saveTimer("user-1", { ...paused, running: false, anchorAt: null });
    const requestResume = vi.fn(() => false);
    await act(async () =>
      root.render(
        <ActiveTimerBar
          owner="user-1"
          lang="en"
          t={(fa) => fa}
          onOpen={vi.fn()}
          requestResume={requestResume}
        />,
      ),
    );

    const resume = host.querySelector<HTMLButtonElement>('button[aria-label="ادامه"]')!;
    await act(async () => resume.click());
    expect(requestResume).toHaveBeenCalledTimes(1);
    expect(loadTimer("user-1").running).toBe(false);
  });
});
