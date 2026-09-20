import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedCompletionList } from "./AnimatedCompletionList";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Item {
  id: string;
  completed: boolean;
}

describe("AnimatedCompletionList", () => {
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

  const order = () =>
    Array.from(host.querySelectorAll<HTMLElement>("[data-completion-id]")).map(
      (element) => element.dataset.completionId,
    );

  function Harness({
    initial = [
      { id: "open", completed: false },
      { id: "done", completed: true },
    ],
  }: {
    initial?: Item[];
  }) {
    const [items, setItems] = useState<Item[]>(initial);
    return (
      <AnimatedCompletionList
        items={items}
        isCompleted={(item) => item.completed}
        renderItem={(item, onCompletionChange) => (
          <button
            data-toggle={item.id}
            onClick={() => {
              const next = !item.completed;
              setItems((current) =>
                current.map((candidate) =>
                  candidate.id === item.id ? { ...candidate, completed: next } : candidate,
                ),
              );
              onCompletionChange(next);
            }}
          >
            {item.id}
          </button>
        )}
      />
    );
  }

  const pointer = (target: Element, type: string, clientY: number, clientX = 0) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: "touch" },
      clientX: { value: clientX },
      clientY: { value: clientY },
    });
    target.dispatchEvent(event);
  };

  it("waits 450ms before grouping a newly completed item in manual order", () => {
    act(() => root.render(<Harness initial={[{ id: "done", completed: true }, { id: "open", completed: false }]} />));
    act(() => host.querySelector<HTMLElement>("[data-toggle=open]")!.click());

    expect(order()).toEqual(["open", "done"]);
    act(() => vi.advanceTimersByTime(449));
    expect(order()).toEqual(["open", "done"]);
    act(() => vi.advanceTimersByTime(1));
    expect(order()).toEqual(["done", "open"]);
  });

  it("keeps multiple completed items in their manual base order, not check time", () => {
    act(() => root.render(<Harness initial={[
      { id: "a", completed: false },
      { id: "b", completed: false },
      { id: "c", completed: false },
    ]} />));
    act(() => host.querySelector<HTMLElement>("[data-toggle=b]")!.click());
    act(() => vi.advanceTimersByTime(450));
    act(() => host.querySelector<HTMLElement>("[data-toggle=a]")!.click());
    act(() => vi.advanceTimersByTime(450));
    expect(order()).toEqual(["c", "a", "b"]);
  });

  it("cancels a pending completion move when the item is reopened quickly", () => {
    act(() => root.render(<Harness />));
    act(() => host.querySelector<HTMLElement>("[data-toggle=open]")!.click());
    act(() => vi.advanceTimersByTime(200));
    act(() => host.querySelector<HTMLElement>("[data-toggle=open]")!.click());
    act(() => vi.advanceTimersByTime(450));

    expect(order()).toEqual(["open", "done"]);
  });

  it("moves a reopened item above the completed section after the same pause", () => {
    act(() =>
      root.render(
        <Harness
          initial={[
            { id: "open", completed: false },
            { id: "done-b", completed: true },
            { id: "done-a", completed: true },
          ]}
        />,
      ),
    );
    act(() => host.querySelector<HTMLElement>("[data-toggle=done-a]")!.click());
    act(() => vi.advanceTimersByTime(450));

    expect(order()).toEqual(["open", "done-a", "done-b"]);
  });

  it("restores a reopened item to its exact manual position", () => {
    act(() =>
      root.render(
        <Harness
          initial={[
            { id: "a", completed: false },
            { id: "b", completed: false },
            { id: "c", completed: false },
          ]}
        />,
      ),
    );
    act(() => host.querySelector<HTMLElement>("[data-toggle=b]")!.click());
    act(() => vi.advanceTimersByTime(450));
    expect(order()).toEqual(["a", "c", "b"]);

    act(() => host.querySelector<HTMLElement>("[data-toggle=b]")!.click());
    act(() => vi.advanceTimersByTime(450));
    expect(order()).toEqual(["a", "b", "c"]);
  });

  it("emits a reordered visible id list after a 350ms vertical long press", () => {
    const onReorder = vi.fn();
    const items: Item[] = [
      { id: "a", completed: false },
      { id: "b", completed: false },
      { id: "c", completed: false },
    ];
    act(() =>
      root.render(
        <AnimatedCompletionList
          items={items}
          isCompleted={(item) => item.completed}
          onReorder={onReorder}
          renderItem={(item) => <span>{item.id}</span>}
        />,
      ),
    );
    const rows = Array.from(host.querySelectorAll<HTMLElement>("[data-completion-id]"));
    rows.forEach((row, index) =>
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: index * 50,
        top: index * 50,
        bottom: index * 50 + 40,
        left: 0,
        right: 100,
        width: 100,
        height: 40,
        toJSON: () => ({}),
      }),
    );

    act(() => pointer(rows[0], "pointerdown", 10));
    act(() => vi.advanceTimersByTime(350));
    act(() => pointer(rows[0], "pointermove", 120));
    act(() => pointer(rows[0], "pointerup", 120));

    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
  });

  it("cancels long press when the pointer moves before activation", () => {
    const onReorder = vi.fn();
    const items: Item[] = [
      { id: "a", completed: false },
      { id: "b", completed: false },
    ];
    act(() =>
      root.render(
        <AnimatedCompletionList
          items={items}
          isCompleted={(item) => item.completed}
          onReorder={onReorder}
          renderItem={(item) => <span>{item.id}</span>}
        />,
      ),
    );
    const row = host.querySelector<HTMLElement>("[data-completion-id=a]")!;
    act(() => pointer(row, "pointerdown", 10));
    act(() => pointer(row, "pointermove", 22));
    act(() => vi.advanceTimersByTime(350));
    act(() => pointer(row, "pointerup", 22));

    expect(onReorder).not.toHaveBeenCalled();
  });
});
