import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeekStrip } from "./WeekStrip";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("WeekStrip settling", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("finishes paging even when the browser omits transitionend", () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <WeekStrip selected="2026-08-29" onSelect={onSelect} cal="gregorian" lang="fa" />,
      );
    });

    expect(host.querySelector(".select-none")?.getAttribute("dir")).toBe("ltr");

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="next-week"]')!.click());
    expect(onSelect).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(360));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("2026-09-05");
  });
});
