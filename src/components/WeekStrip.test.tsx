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

  it("keeps day cells compact on phones while showing arrow controls from sm upward", () => {
    act(() => {
      root.render(
        <WeekStrip selected="2026-08-29" onSelect={() => undefined} cal="gregorian" lang="fa" />,
      );
    });

    for (const arrow of host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="prev-week"], [aria-label="next-week"]',
    )) {
      expect(arrow.className).toContain("hidden");
      expect(arrow.className).toContain("sm:inline-flex");
    }

    const panels = host.querySelectorAll<HTMLDivElement>('div[dir="rtl"]');
    expect(panels).toHaveLength(3);
    expect(panels[0]?.className).toContain("grid-cols-7");
    expect(panels[0]?.className).toContain("gap-0.5");
    const day = panels[0]?.querySelector<HTMLButtonElement>("button");
    expect(day).not.toBeNull();
    expect(day?.className).toContain("min-w-0");
    const circle = day?.querySelector<HTMLElement>("span.relative");
    expect(circle).not.toBeNull();
    expect(circle?.className).toContain("h-9");
    expect(circle?.className).toContain("sm:h-12");
    const mobileContentWidth = 288;
    const mobileCircleWidth = 36;
    const mobileGap = 2;
    expect(mobileCircleWidth * 7 + mobileGap * 6).toBeLessThanOrEqual(mobileContentWidth - 16);
  });

  it("suppresses a day click until arrow paging has settled", () => {
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <WeekStrip selected="2026-08-29" onSelect={onSelect} cal="gregorian" lang="fa" />,
      );
    });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="next-week"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('div[dir="rtl"] button')!.click());
    expect(onSelect).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(360));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("2026-09-05");
  });

  it("settles immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const onSelect = vi.fn();
    act(() => {
      root.render(
        <WeekStrip selected="2026-08-29" onSelect={onSelect} cal="gregorian" lang="fa" />,
      );
    });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="next-week"]')!.click());
    expect(onSelect).toHaveBeenCalledWith("2026-09-05");
  });
});
