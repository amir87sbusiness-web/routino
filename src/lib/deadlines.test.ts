import { describe, expect, it } from "vitest";
import type { Habit, Task } from "./store";
import { isHabitDeadlinePassed, isTaskOverdue, isTaskVisibleOn, tasksVisibleOn } from "./deadlines";

const habit: Habit = {
  id: "habit-1",
  name: "Read",
  categoryId: "study",
  type: "binary",
  target: 1,
  schedule: { kind: "daily" },
  monthlyGoal: null,
  reminderTime: null,
  createdAt: 0,
};

const task: Task = {
  id: "task-1",
  dateKey: "2026-09-20",
  title: "Report",
  type: "binary",
  target: 1,
  value: 0,
  done: false,
};

describe("habit deadlines", () => {
  it("keeps legacy habits writable without a deadline", () => {
    expect(isHabitDeadlinePassed(habit, "2026-09-20", new Date(2026, 8, 20, 23, 59))).toBe(false);
  });

  it("locks a due day exactly at its local deadline", () => {
    const deadlineHabit = { ...habit, deadlineTime: "18:30" };
    expect(
      isHabitDeadlinePassed(deadlineHabit, "2026-09-20", new Date(2026, 8, 20, 18, 29, 59)),
    ).toBe(false);
    expect(isHabitDeadlinePassed(deadlineHabit, "2026-09-20", new Date(2026, 8, 20, 18, 30))).toBe(
      true,
    );
  });
});

describe("task deadline visibility", () => {
  it("keeps a legacy task scoped to its original day", () => {
    expect(isTaskVisibleOn(task, "2026-09-20", new Date(2026, 8, 21, 12))).toBe(true);
    expect(isTaskVisibleOn(task, "2026-09-21", new Date(2026, 8, 21, 12))).toBe(false);
  });

  it("shows an open deadline task from its start through the deadline and after it is overdue", () => {
    const deadlineTask = { ...task, deadlineAt: "2026-09-22T18:30" };
    const now = new Date(2026, 8, 23, 9);
    expect(isTaskVisibleOn(deadlineTask, "2026-09-19", now)).toBe(false);
    expect(isTaskVisibleOn(deadlineTask, "2026-09-21", now)).toBe(true);
    expect(isTaskVisibleOn(deadlineTask, "2026-09-23", now)).toBe(true);
    expect(isTaskOverdue(deadlineTask, now)).toBe(true);
  });

  it("stops carrying a completed deadline task into later days", () => {
    const completed = { ...task, done: true, deadlineAt: "2026-09-22T18:30" };
    expect(isTaskVisibleOn(completed, "2026-09-20", new Date(2026, 8, 23, 9))).toBe(true);
    expect(isTaskVisibleOn(completed, "2026-09-21", new Date(2026, 8, 23, 9))).toBe(false);
    expect(isTaskOverdue(completed, new Date(2026, 8, 23, 9))).toBe(false);
  });

  it("filters a mixed list without changing task objects", () => {
    const deadlineTask = { ...task, id: "deadline", deadlineAt: "2026-09-22T18:30" };
    expect(tasksVisibleOn([task, deadlineTask], "2026-09-21", new Date(2026, 8, 21, 12))).toEqual([
      deadlineTask,
    ]);
  });
});
