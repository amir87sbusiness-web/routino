import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskRow } from "./tasks";
import type { Task } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const task: Task = {
  id: "task-1",
  dateKey: "2026-08-29",
  title: "Test task",
  type: "binary",
  target: 1,
  value: 0,
  done: false,
  icon: "star",
};

function oneYearTaskFixture(): Task[] {
  return Array.from({ length: 365 * 10 }, (_, index) => ({
    ...task,
    id: `task-${index}`,
    dateKey: new Date(Date.UTC(2025, 0, Math.floor(index / 10) + 1)).toISOString().slice(0, 10),
    title: index % 2 === 0 ? `مطالعه ${index}` : `کار ${index}`,
    done: true,
    value: 1,
  }));
}

describe("Task history representation", () => {
  it("keeps yearly task search identical after server archive expansion", () => {
    const before = oneYearTaskFixture();
    const after = before.map((item) => ({ ...item }));
    expect(after).toEqual(before);
    expect(after.filter((item) => item.title.includes("مطالعه"))).toEqual(
      before.filter((item) => item.title.includes("مطالعه")),
    );
  });
});

describe("TaskRow completion transitions", () => {
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

  function renderRow(onUpdate: () => boolean, onCompletionChange: (completed: boolean) => void) {
    act(() => {
      root.render(
        <TaskRow
          task={task}
          settings={{ completionSoundEnabled: false, hapticsEnabled: false }}
          lang="en"
          t={(_fa, en) => en}
          onUpdate={onUpdate}
          onDelete={() => undefined}
          onCompletionChange={onCompletionChange}
        />,
      );
    });
  }

  it("does not notify list ordering when the mutation is rejected", () => {
    const onCompletionChange = vi.fn();
    renderRow(() => false, onCompletionChange);

    act(() => host.querySelector("button")!.click());

    expect(onCompletionChange).not.toHaveBeenCalled();
  });

  it("notifies list ordering once after an accepted completion boundary", () => {
    const onCompletionChange = vi.fn();
    renderRow(() => true, onCompletionChange);

    act(() => host.querySelector("button")!.click());

    expect(onCompletionChange).toHaveBeenCalledTimes(1);
    expect(onCompletionChange).toHaveBeenCalledWith(true);
  });
});
