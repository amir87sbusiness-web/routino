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

  it("waits 450ms before moving a newly completed item to the absolute bottom", () => {
    act(() => root.render(<Harness />));
    act(() => host.querySelector<HTMLElement>("[data-toggle=open]")!.click());

    expect(order()).toEqual(["open", "done"]);
    act(() => vi.advanceTimersByTime(449));
    expect(order()).toEqual(["open", "done"]);
    act(() => vi.advanceTimersByTime(1));
    expect(order()).toEqual(["done", "open"]);
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
});
