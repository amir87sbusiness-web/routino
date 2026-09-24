import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addQuickTask,
  draftToTask,
  enableTaskReminderNotifications,
  emptyTaskDraft,
  nextQuickTaskColor,
  resolveTaskAppearance,
  uncategorizedTaskColor,
  TaskFormModal,
  TaskRow,
  taskToDraft,
  TodayTodosCard,
} from "./tasks";
import type { Category, Task } from "@/lib/store";
import { defaultDb } from "@/lib/store";
import { CATEGORY_COLOR_CHOICES } from "@/lib/presets";
import {
  archiveExpandedOneYearTasks,
  oneYearTaskFixture,
} from "../../test/helpers/task-archive-compat";

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

const category: Category = {
  id: "work",
  nameFa: "کار",
  nameEn: "Work",
  color: "#2563eb",
  icon: "briefcase",
  isDefault: false,
};

describe("Task history representation", () => {
  it("keeps yearly task search identical after server archive expansion", () => {
    const before = oneYearTaskFixture();
    const after = archiveExpandedOneYearTasks();
    expect(after).toEqual(before);
    expect(after.filter((item) => item.title.includes("مطالعه"))).toEqual(
      before.filter((item) => item.title.includes("مطالعه")),
    );
  });
});

describe("task draft compatibility", () => {
  it("round-trips an optional category and its legacy appearance snapshot", () => {
    const categorized = draftToTask(
      {
        ...emptyTaskDraft("2026-09-19"),
        title: "گزارش",
        categoryId: category.id,
        color: category.color,
        icon: category.icon,
      },
      undefined,
    );

    expect(categorized).toMatchObject({
      categoryId: "work",
      color: "#2563eb",
      icon: "briefcase",
    });
    expect(taskToDraft(categorized)).toMatchObject({ categoryId: "work" });

    const uncategorized = draftToTask(
      { ...taskToDraft(categorized), categoryId: null },
      categorized,
    );
    expect(uncategorized.categoryId).toBeNull();
    expect(uncategorized.color).toBe(category.color);
    expect(uncategorized.icon).toBe(category.icon);
  });

  it("does not request permission while saving a reminder", () => {
    const updatePreferences = vi.fn();
    enableTaskReminderNotifications({ updatePreferences, t: (_fa, en) => en });
    expect(updatePreferences).not.toHaveBeenCalled();
  });

  it("loads a legacy binary task without requiring new fields", () => {
    expect(taskToDraft(task)).toMatchObject({
      id: task.id,
      dateKey: task.dateKey,
      title: task.title,
      type: "binary",
      target: 1,
      unitKind: "count",
      reminderOn: false,
      deadlineOn: false,
    });
  });

  it("round-trips an optional task deadline independently from its reminder", () => {
    const draft = {
      ...emptyTaskDraft("2026-09-19"),
      title: "گزارش",
      deadlineOn: true,
      deadlineDate: "2026-09-23",
      deadlineTime: "18:30",
    };

    const saved = draftToTask(draft);
    expect(saved.deadlineAt).toBe("2026-09-23T18:30");
    expect(saved.reminderAt).toBeNull();
    expect(taskToDraft(saved)).toMatchObject({
      deadlineOn: true,
      deadlineDate: "2026-09-23",
      deadlineTime: "18:30",
    });
  });

  it("creates a count task with its numeric target", () => {
    const draft = {
      ...emptyTaskDraft("2026-09-19"),
      title: "مطالعه",
      type: "quantity" as const,
      unitKind: "count" as const,
      target: 12,
    };

    expect(draftToTask(draft)).toMatchObject({
      dateKey: "2026-09-19",
      title: "مطالعه",
      type: "quantity",
      unitKind: "count",
      target: 12,
      value: 0,
      done: false,
    });
  });

  it("stores a time task in minutes and preserves identity while editing", () => {
    const existing: Task = {
      ...task,
      type: "quantity",
      unitKind: "time",
      target: 25,
      value: 10,
    };
    const draft = { ...taskToDraft(existing), dateKey: "2026-09-20", target: 45 };

    expect(draftToTask(draft, existing)).toMatchObject({
      id: existing.id,
      dateKey: "2026-09-20",
      type: "quantity",
      unitKind: "time",
      target: 45,
      value: 10,
      done: false,
    });
  });
});

describe("quick task colors", () => {
  it("assigns different palette colors to consecutive quick tasks on the same day", () => {
    const dateKey = "2026-09-19";
    const firstColor = nextQuickTaskColor([], dateKey);
    const first = addQuickTask(defaultDb([]), dateKey, "اول").task;
    const second = addQuickTask({ ...defaultDb([]), tasks: [first] }, dateKey, "دوم").task;

    expect(firstColor).toBe(CATEGORY_COLOR_CHOICES[0]);
    expect(first.color).toBe(firstColor);
    expect(second.color).toBe(CATEGORY_COLOR_CHOICES[1]);
    expect(second.color).not.toBe(first.color);
    expect("categoryId" in first).toBe(false);
  });
});

describe("task appearance", () => {
  it("derives a stable palette color when a categorized task becomes uncategorized", () => {
    const first = uncategorizedTaskColor("task-1");
    expect(CATEGORY_COLOR_CHOICES).toContain(first);
    expect(uncategorizedTaskColor("task-1")).toBe(first);
  });

  it("uses the live category appearance when the category still exists", () => {
    expect(
      resolveTaskAppearance({ ...task, categoryId: category.id, color: "#111111", icon: "star" }, [
        category,
      ]),
    ).toEqual({ color: category.color, icon: category.icon });
  });

  it("uses a stable default icon and task color when a category is missing", () => {
    expect(
      resolveTaskAppearance(
        { ...task, categoryId: "deleted", color: "#7c3aed", icon: "briefcase" },
        [],
      ),
    ).toEqual({ color: "#7c3aed", icon: "star" });
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

  it("keeps a checkbox tap independent from a horizontal row gesture", () => {
    const onUpdate = vi.fn(() => true);
    renderRow(onUpdate, vi.fn());

    const checkbox = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle task completion"]',
    )!;
    expect(checkbox.className).toContain("h-11");
    expect(checkbox.className).toContain("w-11");
    const pointer = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        clientX: { value: clientX },
        clientY: { value: 0 },
      });
      return event;
    };

    act(() => {
      checkbox.dispatchEvent(pointer("pointerdown", 0));
      checkbox.dispatchEvent(pointer("pointermove", 12));
      checkbox.dispatchEvent(pointer("pointerup", 12));
      checkbox.click();
    });

    expect(onUpdate).toHaveBeenCalledWith({ done: true, value: 1 });
  });

  it("opens editing without toggling completion", () => {
    const onUpdate = vi.fn(() => true);
    const onEdit = vi.fn();
    act(() => {
      root.render(
        <TaskRow
          task={task}
          settings={{ completionSoundEnabled: false, hapticsEnabled: false }}
          lang="en"
          t={(_fa, en) => en}
          onUpdate={onUpdate}
          onDelete={() => undefined}
          onEdit={onEdit}
        />,
      );
    });

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Edit task"]')!.click());

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("TaskFormModal measurement controls", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("offers binary, count, and time task choices", () => {
    function Harness() {
      const [draft, setDraft] = useState(() => emptyTaskDraft("2026-09-19"));
      return (
        <TaskFormModal
          open
          draft={draft}
          setDraft={setDraft}
          onClose={() => undefined}
          onSave={() => undefined}
          cal="gregorian"
          lang="en"
          t={(_fa, en) => en}
          categories={[category]}
        />
      );
    }
    act(() => {
      root.render(<Harness />);
    });

    expect(document.body.textContent).toContain("Done / not done");
    expect(document.body.textContent).toContain("Quantity");

    const quantityButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Quantity",
    );
    act(() => quantityButton!.click());

    expect(document.body.textContent).toContain("Count (number)");
    expect(document.body.textContent).toContain("Time (hr/min/sec)");
    expect(document.body.textContent).toContain("Deadline");
  });

  it("restores the uncategorized legacy snapshot after selecting then clearing a category", () => {
    function Harness() {
      const [draft, setDraft] = useState(() => emptyTaskDraft("2026-09-19"));
      return (
        <>
          <output data-testid="draft-snapshot">
            {JSON.stringify({ categoryId: draft.categoryId, color: draft.color, icon: draft.icon })}
          </output>
          <TaskFormModal
            open
            draft={draft}
            setDraft={setDraft}
            onClose={() => undefined}
            onSave={() => undefined}
            cal="gregorian"
            lang="en"
            t={(_fa, en) => en}
            categories={[category]}
          />
        </>
      );
    }
    act(() => root.render(<Harness />));

    expect(document.body.textContent).toContain("Category");
    expect(document.body.textContent).toContain("Without category");
    expect(document.body.textContent).toContain("Work");
    expect(document.body.textContent).not.toContain("Icon");
    expect(document.body.textContent).not.toContain("Color");

    const workButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Work",
    )!;
    act(() => workButton.click());
    expect(workButton.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-testid="draft-snapshot"]')?.textContent).toBe(
      JSON.stringify({ categoryId: "work", color: category.color, icon: category.icon }),
    );

    const withoutCategoryButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Without category",
    )!;
    act(() => withoutCategoryButton.click());
    expect(document.querySelector('[data-testid="draft-snapshot"]')?.textContent).toBe(
      JSON.stringify({ categoryId: null, color: CATEGORY_COLOR_CHOICES[0], icon: "star" }),
    );
  });

  it("closes an open deadline picker when the deadline is removed", () => {
    function Harness() {
      const [draft, setDraft] = useState(() => emptyTaskDraft("2026-09-19"));
      return (
        <TaskFormModal
          open
          draft={draft}
          setDraft={setDraft}
          onClose={() => undefined}
          onSave={() => undefined}
          cal="gregorian"
          lang="en"
          t={(_fa, en) => en}
        />
      );
    }
    act(() => root.render(<Harness />));

    const deadlineSwitch = document.body.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Deadline"]',
    )!;
    act(() => deadlineSwitch.click());
    act(() =>
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent === "18:00")!
        .click(),
    );
    expect(document.body.textContent).toContain("24-hour format");

    act(() => deadlineSwitch.click());
    act(() => deadlineSwitch.click());

    expect(document.body.textContent).not.toContain("24-hour format");
  });

  it("closes an open deadline date picker when the deadline is removed", () => {
    function Harness() {
      const [draft, setDraft] = useState(() => emptyTaskDraft("2026-09-19"));
      return (
        <TaskFormModal
          open
          draft={draft}
          setDraft={setDraft}
          onClose={() => undefined}
          onSave={() => undefined}
          cal="gregorian"
          lang="en"
          t={(_fa, en) => en}
        />
      );
    }
    act(() => root.render(<Harness />));

    const deadlineSwitch = document.body.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Deadline"]',
    )!;
    act(() => deadlineSwitch.click());
    const deadlineDateButton = Array.from(document.body.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("September 19"))
      .at(-1)!;
    act(() => deadlineDateButton.click());
    expect(document.body.querySelector('button[aria-label="prev-month"]')).not.toBeNull();

    act(() => deadlineSwitch.click());
    act(() => deadlineSwitch.click());

    expect(document.body.querySelector('button[aria-label="prev-month"]')).toBeNull();
  });

  it("keeps the reminder picker closed after a reminder is removed and re-enabled", () => {
    function Harness() {
      const [draft, setDraft] = useState(() => emptyTaskDraft("2026-09-19"));
      return (
        <TaskFormModal
          open
          draft={draft}
          setDraft={setDraft}
          onClose={() => undefined}
          onSave={() => undefined}
          cal="gregorian"
          lang="en"
          t={(_fa, en) => en}
        />
      );
    }
    act(() => root.render(<Harness />));

    const reminderSwitch = document.body.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Reminder"]',
    )!;
    act(() => reminderSwitch.click());
    act(() =>
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent === "09:00")!
        .click(),
    );
    expect(document.body.textContent).toContain("24-hour format");

    act(() => reminderSwitch.click());
    act(() => reminderSwitch.click());

    expect(document.body.textContent).not.toContain("24-hour format");
  });
});

describe("TaskRow deadline state", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 23, 9));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("labels an unfinished task after its deadline as overdue", () => {
    act(() => {
      root.render(
        <TaskRow
          task={{ ...task, deadlineAt: "2026-09-22T18:30" }}
          settings={{ completionSoundEnabled: false, hapticsEnabled: false }}
          lang="en"
          t={(_fa, en) => en}
          onUpdate={() => true}
          onDelete={() => undefined}
        />,
      );
    });

    expect(host.textContent).toContain("Overdue");
  });
});

describe("TodayTodosCard editing", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps quick add and opens an existing task in the edit form", () => {
    function Harness() {
      const [db, setDb] = useState(() => ({ ...defaultDb([category]), tasks: [task] }));
      return (
        <TodayTodosCard
          db={db}
          dateKey={task.dateKey}
          cal="gregorian"
          lang="en"
          t={(_fa, en) => en}
          onUpdate={(update) => {
            setDb((current) => update(current));
            return true;
          }}
        />
      );
    }
    act(() => root.render(<Harness />));

    expect(host.querySelector('input[placeholder="+ Add Todo"]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Edit task"]')!.click());

    expect(document.body.textContent).toContain("Edit task");
    expect(
      document.body.querySelector<HTMLInputElement>('input[value="Test task"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Work");
  });
});
