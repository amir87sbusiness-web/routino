import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HabitRow } from "./habits";
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
});
