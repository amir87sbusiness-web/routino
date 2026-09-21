import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftToHabit, emptyDraft, HabitFormModal, HabitRow, habitToDraft } from "./habits";
import { todayKey } from "@/lib/dates";
import { defaultDb, type Category, type Habit } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const category: Category = {
  id: "health",
  nameFa: "سلامت",
  nameEn: "Health",
  color: "#22c55e",
  icon: "heart",
  isDefault: true,
};

const habit: Habit = {
  id: "habit-1",
  name: "Test habit",
  categoryId: category.id,
  type: "binary",
  target: 1,
  schedule: { kind: "daily" },
  monthlyGoal: null,
  reminderTime: null,
  createdAt: 0,
};

describe("HabitRow completion transitions", () => {
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
    const db = defaultDb([category]);
    db.settings.completionSoundEnabled = false;
    db.settings.hapticsEnabled = false;
    act(() => {
      root.render(
        <HabitRow
          db={db}
          habit={habit}
          cal="gregorian"
          lang="en"
          t={(_fa, en) => en}
          dk={todayKey()}
          onUpdate={onUpdate}
          onCompletionChange={onCompletionChange}
        />,
      );
    });
  }

  it("notifies ordering only after an accepted habit completion", () => {
    const rejectedNotification = vi.fn();
    renderRow(() => false, rejectedNotification);
    act(() => host.querySelector<HTMLButtonElement>(".swipe-row button")!.click());
    expect(rejectedNotification).not.toHaveBeenCalled();

    const acceptedNotification = vi.fn();
    renderRow(() => true, acceptedNotification);
    act(() => host.querySelector<HTMLButtonElement>(".swipe-row button")!.click());
    expect(acceptedNotification).toHaveBeenCalledOnce();
    expect(acceptedNotification).toHaveBeenCalledWith(true);
  });

  it("blocks a new completion after today's deadline", () => {
    vi.setSystemTime(new Date(2026, 8, 21, 19));
    const onUpdate = vi.fn(() => true);
    const db = defaultDb([category]);
    act(() => {
      root.render(
        <HabitRow
          db={db}
          habit={{ ...habit, deadlineTime: "18:30" }}
          cal="gregorian"
          lang="en"
          t={(_fa, en) => en}
          dk={todayKey()}
          onUpdate={onUpdate}
        />,
      );
    });

    act(() => host.querySelector<HTMLButtonElement>(".swipe-row button")!.click());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("asks before undoing a completed habit after its deadline", () => {
    vi.setSystemTime(new Date(2026, 8, 21, 19));
    const onUpdate = vi.fn(() => true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const db = defaultDb([category]);
    db.logs[`${habit.id}|${todayKey()}`] = {
      habitId: habit.id,
      dateKey: todayKey(),
      value: 1,
      done: true,
    };
    act(() => {
      root.render(
        <HabitRow
          db={db}
          habit={{ ...habit, deadlineTime: "18:30" }}
          cal="gregorian"
          lang="en"
          t={(_fa, en) => en}
          dk={todayKey()}
          onUpdate={onUpdate}
        />,
      );
    });

    act(() => host.querySelector<HTMLButtonElement>(".swipe-row button")!.click());
    expect(confirm).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    act(() => host.querySelector<HTMLButtonElement>(".swipe-row button")!.click());
    expect(onUpdate).toHaveBeenCalledOnce();
  });
});

describe("habit deadline draft compatibility", () => {
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

  it("keeps legacy habits deadline-free and round-trips a selected deadline", () => {
    expect(habitToDraft(habit).deadlineTime).toBe("");
    expect(draftToHabit(emptyDraft(category.id)).deadlineTime).toBeNull();
    expect(
      draftToHabit({ ...emptyDraft(category.id), name: "Read", deadlineTime: "18:30" })
        .deadlineTime,
    ).toBe("18:30");
  });

  it("shows a separate deadline control in the habit form", () => {
    act(() => {
      root.render(
        <HabitFormModal
          open
          onClose={() => undefined}
          draft={{ ...emptyDraft(category.id), name: "Read" }}
          setDraft={() => undefined}
          categories={[category]}
          onSave={() => undefined}
          lang="en"
          t={(_fa, en) => en}
        />,
      );
    });
    expect(document.body.textContent).toContain("Deadline");
  });
});
