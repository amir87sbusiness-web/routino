import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHorizontalDrag, type HorizontalDragSample } from "./useHorizontalDrag";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function pointer(type: string, clientX: number, clientY: number, pointerId = 1): Event {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

describe("useHorizontalDrag", () => {
  let host: HTMLDivElement;
  let root: Root;
  let frame: FrameRequestCallback | null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    frame = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frame = null;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("delivers pointer movement on animation frames without rerendering React", () => {
    const moves: number[] = [];
    const endings: HorizontalDragSample[] = [];
    let renders = 0;

    function Harness() {
      renders += 1;
      const bindings = useHorizontalDrag({
        onMove: (sample) => moves.push(sample.dx),
        onEnd: (sample) => endings.push(sample),
      });
      return <div data-testid="surface" {...bindings} />;
    }

    act(() => root.render(<Harness />));
    const surface = host.querySelector<HTMLElement>("[data-testid=surface]")!;

    act(() => {
      surface.dispatchEvent(pointer("pointerdown", 10, 10));
      surface.dispatchEvent(pointer("pointermove", 42, 12));
    });
    act(() => frame?.(16));

    expect(moves).toEqual([32]);
    expect(renders).toBe(1);

    act(() => surface.dispatchEvent(pointer("pointerup", 42, 12)));
    expect(moves).toEqual([32]);
    expect(endings).toHaveLength(1);
    expect(endings[0]?.dx).toBe(32);
    expect(renders).toBe(1);
  });

  it("leaves a dominant vertical gesture to page scrolling", () => {
    const moves: number[] = [];
    const endings: HorizontalDragSample[] = [];

    function Harness() {
      const bindings = useHorizontalDrag({
        onMove: (sample) => moves.push(sample.dx),
        onEnd: (sample) => endings.push(sample),
      });
      return <div data-testid="surface" {...bindings} />;
    }

    act(() => root.render(<Harness />));
    const surface = host.querySelector<HTMLElement>("[data-testid=surface]")!;

    act(() => {
      surface.dispatchEvent(pointer("pointerdown", 10, 10));
      surface.dispatchEvent(pointer("pointermove", 13, 32));
      surface.dispatchEvent(pointer("pointerup", 13, 32));
    });

    expect(frame).toBeNull();
    expect(moves).toEqual([]);
    expect(endings).toEqual([]);
  });
});
