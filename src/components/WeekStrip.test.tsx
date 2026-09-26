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

  it("grows day circles from 351px without crowding narrow phones", () => {
    act(() => {
      root.render(
        <WeekStrip selected="2026-08-29" onSelect={() => undefined} cal="gregorian" lang="fa" />,
      );
    });

    for (const arrow of host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="prev-week"], [aria-label="next-week"]',
    )) {
      expect(arrow.className).toContain("inline-flex");
      expect(arrow.className).toContain("w-5");
      expect(arrow.className).toContain("p-0");
      expect(arrow.className).not.toContain("hidden");
    }

    const strip = host.firstElementChild;
    expect(strip?.className).toContain("-mx-3");

    const panels = host.querySelectorAll<HTMLDivElement>('div[dir="rtl"]');
    expect(panels).toHaveLength(3);
    expect(panels[0]?.className).toContain("grid-cols-7");
    expect(panels[0]?.className).toContain("gap-0");
    const day = panels[0]?.querySelector<HTMLButtonElement>("button");
    expect(day).not.toBeNull();
    expect(day?.className).toContain("min-w-0");
    const circle = day?.querySelector<HTMLElement>("span.relative");
    expect(circle).not.toBeNull();
    expect(circle?.className).toContain("h-[38px]");
    expect(circle?.className).toContain("w-[38px]");
    expect(circle?.className).toContain("min-[351px]:h-[42px]");
    expect(circle?.className).toContain("min-[351px]:w-[42px]");
    expect(circle?.className).toContain("sm:h-12");
    const date = circle?.querySelector<HTMLElement>("span.z-10");
    expect(date?.className).toContain("h-[31px]");
    expect(date?.className).toContain("w-[31px]");
    expect(date?.className).toContain("min-[351px]:h-[34px]");
    expect(date?.className).toContain("min-[351px]:w-[34px]");

    const pageContentWidth = 288;
    const horizontalBleed = 24;
    const mobileArrowWidth = 20;
    const mobileCircleWidth = 38;
    expect(mobileCircleWidth * 7).toBeLessThanOrEqual(
      pageContentWidth + horizontalBleed - mobileArrowWidth * 2,
    );

    const breakpointContentWidth = 319;
    const breakpointCircleWidth = 42;
    expect(breakpointCircleWidth * 7).toBeLessThanOrEqual(
      breakpointContentWidth + horizontalBleed - mobileArrowWidth * 2,
    );
  });

  it("renders a filled progress arc for all seven days in the visible week", () => {
    act(() => {
      root.render(
        <WeekStrip
          selected="2026-08-29"
          onSelect={() => undefined}
          cal="gregorian"
          lang="fa"
          percentFor={() => 50}
        />,
      );
    });

    const panels = host.querySelectorAll<HTMLDivElement>("div.grid.grid-cols-7");
    expect(panels).toHaveLength(3);
    const progressArcs = panels[1]!.querySelectorAll('circle[stroke-linecap="round"]');
    expect(progressArcs).toHaveLength(7);
    for (const arc of progressArcs) {
      expect(arc.getAttribute("r")).toBe("20");
      expect(arc.getAttribute("stroke-dasharray")).toMatch(/^62\.83/);
    }

    const activeDay = panels[1]!.querySelector("span.bg-primary")?.closest("button");
    expect(activeDay).not.toBeNull();
    expect(activeDay?.querySelector("svg")?.getAttribute("class")).toContain("z-20");
    expect(activeDay?.querySelector('circle[stroke-linecap="round"]')?.getAttribute("stroke")).toBe(
      "var(--primary-foreground)",
    );
    for (const arc of progressArcs) {
      if (activeDay?.contains(arc)) continue;
      expect(arc.getAttribute("stroke")).toBe("var(--primary)");
    }
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
