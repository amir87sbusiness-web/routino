import { describe, expect, it } from "vitest";
import { defaultDb, logKey, type Goal, type GoalItem, type Habit, type Task } from "./store";
import {
  addGoalItem,
  completeFullyProgressedGoals,
  completeCustomGoalItem,
  createCustomGoalItem,
  createGoalItem,
  goalItemProgress,
  goalDeadlineState,
  goalOverview,
  highestCrossedGoalMilestone,
  goalProgress,
  linkedGoalsForSource,
  reconfigureCustomGoalItem,
  reopenRegressedGoals,
  updateCustomGoalItem,
} from "./goals";

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "habit-1",
    name: "Running",
    categoryId: "sport",
    type: "binary",
    target: 1,
    schedule: { kind: "daily" },
    monthlyGoal: null,
    reminderTime: null,
    createdAt: 1,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    dateKey: "2026-09-29",
    title: "Buy shoes",
    type: "binary",
    target: 1,
    value: 0,
    done: false,
    ...overrides,
  };
}

function goal(items: GoalItem[] = []): Goal {
  return {
    id: "goal-1",
    title: "Get fit",
    priority: "normal",
    status: "active",
    items,
    createdAt: 1,
  };
}

describe("source goal items", () => {
  it("captures source measure, title, and link-day baseline", () => {
    const db = defaultDb([]);
    db.habits = [habit()];
    db.logs[logKey("habit-1", "2026-09-29")] = {
      habitId: "habit-1",
      dateKey: "2026-09-29",
      value: 1,
      done: true,
    };

    expect(
      createGoalItem(db, "habit", "habit-1", 10, new Date(2026, 8, 29, 12).getTime()),
    ).toMatchObject({
      kind: "source",
      sourceType: "habit",
      sourceId: "habit-1",
      sourceTitleSnapshot: "Running",
      measure: "binary",
      target: 10,
      linkedDateKey: "2026-09-29",
      baselineValue: 1,
    });
  });

  it("maps quantity sources to count or time and forces binary task target to one", () => {
    const db = defaultDb([]);
    db.habits = [habit({ type: "quantity", unitKind: "time", target: 30 })];
    db.tasks = [
      task({ id: "count", type: "quantity", unitKind: "count", target: 8, value: 3 }),
      task({ id: "binary" }),
    ];
    const at = new Date(2026, 8, 29).getTime();

    expect(createGoalItem(db, "habit", "habit-1", 1_200, at)).toMatchObject({
      measure: "time",
      target: 1_200,
      baselineValue: 0,
    });
    expect(createGoalItem(db, "task", "count", 20, at)).toMatchObject({
      measure: "count",
      target: 20,
      baselineValue: 3,
    });
    expect(createGoalItem(db, "task", "binary", 25, at)).toMatchObject({
      measure: "binary",
      target: 1,
    });
  });

  it("subtracts baseline only from the link day, not later binary or quantity progress", () => {
    const at = new Date(2026, 8, 29, 12).getTime();
    const binaryDb = defaultDb([]);
    binaryDb.habits = [habit()];
    binaryDb.logs[logKey("habit-1", "2026-09-29")] = {
      habitId: "habit-1",
      dateKey: "2026-09-29",
      value: 1,
      done: true,
    };
    const binary = createGoalItem(binaryDb, "habit", "habit-1", 2, at);
    binaryDb.logs[logKey("habit-1", "2026-09-29")].done = false;
    binaryDb.logs[logKey("habit-1", "2026-09-30")] = {
      habitId: "habit-1",
      dateKey: "2026-09-30",
      value: 1,
      done: true,
    };
    expect(goalItemProgress(binaryDb, binary)).toMatchObject({ value: 1, percent: 50 });

    const countDb = defaultDb([]);
    countDb.habits = [habit({ type: "quantity", unitKind: "count", target: 8 })];
    countDb.logs[logKey("habit-1", "2026-09-29")] = {
      habitId: "habit-1",
      dateKey: "2026-09-29",
      value: 3,
      done: false,
    };
    const count = createGoalItem(countDb, "habit", "habit-1", 10, at);
    delete countDb.logs[logKey("habit-1", "2026-09-29")];
    countDb.logs[logKey("habit-1", "2026-09-30")] = {
      habitId: "habit-1",
      dateKey: "2026-09-30",
      value: 4,
      done: false,
    };
    expect(goalItemProgress(countDb, count)).toMatchObject({ value: 4, percent: 40 });
  });

  it("marks missing or type-changed sources without inventing progress", () => {
    const db = defaultDb([]);
    db.tasks = [task({ type: "quantity", unitKind: "count", target: 5 })];
    const item = createGoalItem(db, "task", "task-1", 10, new Date(2026, 8, 29).getTime());

    db.tasks = [{ ...db.tasks[0], unitKind: "time" }];
    expect(goalItemProgress(db, item)).toMatchObject({
      value: 0,
      needsRelink: true,
      sourceMissing: false,
    });
    db.tasks = [];
    expect(goalItemProgress(db, item)).toMatchObject({
      value: 0,
      needsRelink: false,
      sourceMissing: true,
    });
  });

  it("does not add the same source twice to one goal", () => {
    const db = defaultDb([]);
    db.habits = [habit()];
    const first = createGoalItem(db, "habit", "habit-1", 10, 1);
    const existing = goal([first]);
    const duplicate = createGoalItem(db, "habit", "habit-1", 20, 2);

    expect(addGoalItem(existing, duplicate)).toBe(existing);
    expect(addGoalItem(existing, duplicate).items).toHaveLength(1);
  });

  it("keeps a goal within the sync contract item limit", () => {
    const items = Array.from({ length: 50 }, (_, index) =>
      createCustomGoalItem({ title: `Step ${index}`, measure: "binary" }),
    );
    const existing = goal(items);
    expect(
      addGoalItem(existing, createCustomGoalItem({ title: "One too many", measure: "binary" })),
    ).toBe(existing);
  });
});

describe("custom goal items", () => {
  it("creates and updates binary, count, and time items", () => {
    const db = defaultDb([]);
    const binary = createCustomGoalItem({ title: "Register", measure: "binary" });
    const count = createCustomGoalItem({
      title: "Read books",
      measure: "count",
      target: 10,
      unit: "book",
    });
    const time = createCustomGoalItem({ title: "Deep work", measure: "time", targetMinutes: 120 });

    expect(goalItemProgress(db, binary)).toMatchObject({ value: 0, target: 1, percent: 0 });
    expect(goalItemProgress(db, count)).toMatchObject({ value: 0, target: 10, percent: 0 });
    expect(goalItemProgress(db, time)).toMatchObject({ value: 0, target: 120, percent: 0 });

    const completedBinary = updateCustomGoalItem(binary, { value: true });
    const advancedCount = updateCustomGoalItem(count, { value: 4 });
    const advancedTime = updateCustomGoalItem(time, { valueMinutes: 45 });

    expect(goalItemProgress(db, completedBinary)).toMatchObject({ percent: 100, complete: true });
    expect(goalItemProgress(db, advancedCount)).toMatchObject({ value: 4, percent: 40 });
    expect(goalItemProgress(db, advancedTime)).toMatchObject({ value: 45, percent: 38 });
    expect(count).toMatchObject({ value: 0, target: 10 });
  });

  it("ignores non-finite count and time progress updates", () => {
    const count = createCustomGoalItem({ title: "Read", measure: "count", target: 10 });
    const time = createCustomGoalItem({ title: "Focus", measure: "time", targetMinutes: 60 });

    expect(updateCustomGoalItem(count, { value: Number.NaN })).toBe(count);
    expect(updateCustomGoalItem(time, { valueMinutes: Number.POSITIVE_INFINITY })).toBe(time);
    if (count.measure !== "count" || time.measure !== "time")
      throw new Error("unexpected item type");
    expect(count.value).toBe(0);
    expect(time.valueMinutes).toBe(0);
  });

  it("edits an item's target without replacing its identity or current progress", () => {
    const count = {
      ...updateCustomGoalItem(
      createCustomGoalItem({ title: "Read", measure: "count", target: 10, unit: "page" }),
      { value: 4 },
      ),
      note: "خوب بود",
      mood: "💪",
    };

    expect(
      reconfigureCustomGoalItem(count, {
        title: "Read books",
        measure: "count",
        target: 20,
        unit: "book",
      }),
    ).toEqual({ ...count, title: "Read books", target: 20, unit: "book" });
  });

  it("resets progress when an independent item changes measurement type", () => {
    const count = updateCustomGoalItem(
      createCustomGoalItem({ title: "Practice", measure: "count", target: 10 }),
      { value: 7 },
    );

    expect(
      reconfigureCustomGoalItem(count, {
        title: "Practice",
        measure: "time",
        targetMinutes: 90,
      }),
    ).toEqual({
      id: count.id,
      kind: "custom",
      title: "Practice",
      measure: "time",
      valueMinutes: 0,
      targetMinutes: 90,
    });
  });

  it("completes and reopens every independent item measurement", () => {
    const binary = createCustomGoalItem({ title: "Register", measure: "binary" });
    const count = updateCustomGoalItem(
      createCustomGoalItem({ title: "Read", measure: "count", target: 10 }),
      { value: 4 },
    );
    const time = updateCustomGoalItem(
      createCustomGoalItem({ title: "Train", measure: "time", targetMinutes: 120 }),
      { valueMinutes: 45 },
    );

    expect(completeCustomGoalItem(binary, true)).toMatchObject({ value: true });
    expect(completeCustomGoalItem(count, true)).toMatchObject({ value: 10 });
    expect(completeCustomGoalItem(time, true)).toMatchObject({ valueMinutes: 120 });
    expect(completeCustomGoalItem(count, false)).toMatchObject({ value: 0 });
    expect(completeCustomGoalItem(time, false)).toMatchObject({ valueMinutes: 0 });
  });

  it("allows up to 9999 hours and 59 minutes for an independent time target", () => {
    expect(
      createCustomGoalItem({
        title: "Long practice",
        measure: "time",
        targetMinutes: 9999 * 60 + 59,
      }),
    ).toMatchObject({ targetMinutes: 9999 * 60 + 59 });
    expect(() =>
      createCustomGoalItem({
        title: "Too long",
        measure: "time",
        targetMinutes: 10000 * 60,
      }),
    ).toThrow("goal-time-target-too-large");
  });
});

describe("goal progress", () => {
  it("mixes two tasks, three habits, and a custom item in one simple average", () => {
    const db = defaultDb([]);
    db.tasks = [task({ id: "task-done", done: true }), task({ id: "task-open" })];
    db.habits = [
      habit({ id: "habit-binary" }),
      habit({ id: "habit-count", type: "quantity", unitKind: "count", target: 8 }),
      habit({ id: "habit-time", type: "quantity", unitKind: "time", target: 30 }),
    ];
    const at = new Date(2026, 8, 29).getTime();
    const items: GoalItem[] = [
      createGoalItem(db, "task", "task-done", 1, at),
      createGoalItem(db, "task", "task-open", 1, at),
      createGoalItem(db, "habit", "habit-binary", 2, at),
      createGoalItem(db, "habit", "habit-count", 10, at),
      createGoalItem(db, "habit", "habit-time", 60, at),
      updateCustomGoalItem(
        createCustomGoalItem({ title: "Custom", measure: "count", target: 10 }),
        { value: 6 },
      ),
    ];
    db.logs = {
      [logKey("habit-binary", "2026-09-30")]: {
        habitId: "habit-binary",
        dateKey: "2026-09-30",
        value: 1,
        done: true,
      },
      [logKey("habit-count", "2026-09-30")]: {
        habitId: "habit-count",
        dateKey: "2026-09-30",
        value: 8,
        done: true,
      },
      [logKey("habit-time", "2026-09-30")]: {
        habitId: "habit-time",
        dateKey: "2026-09-30",
        value: 15,
        done: false,
      },
    };

    expect(goalProgress(db, goal(items))).toMatchObject({ percent: 53, complete: false });
  });

  it("uses goal status as the manual checkbox only while a goal has no items", () => {
    const db = defaultDb([]);
    expect(goalProgress(db, goal())).toMatchObject({ percent: 0, complete: false });
    expect(goalProgress(db, { ...goal(), status: "completed", completedAt: 2 })).toMatchObject({
      percent: 100,
      complete: true,
    });
  });

  it("shows a manually completed goal as 100 percent even with unfinished items", () => {
    const db = defaultDb([]);
    const unfinished = createCustomGoalItem({ title: "Later", measure: "binary" });
    expect(
      goalProgress(db, { ...goal([unfinished]), status: "completed", completedAt: 2 }),
    ).toMatchObject({ percent: 100, complete: true });
  });

  it("clears manual completion when the first item is added", () => {
    const completed = { ...goal(), status: "completed" as const, completedAt: 2 };
    const item = createCustomGoalItem({ title: "First step", measure: "binary" });

    expect(addGoalItem(completed, item)).toMatchObject({
      status: "active",
      completedAt: null,
      items: [item],
    });
  });

  it("never rounds an incomplete goal to 100", () => {
    const db = defaultDb([]);

    const almost = updateCustomGoalItem(
      createCustomGoalItem({ title: "Almost", measure: "count", target: 200 }),
      { value: 199 },
    );
    const done = updateCustomGoalItem(createCustomGoalItem({ title: "Done", measure: "binary" }), {
      value: true,
    });
    expect(goalProgress(db, goal([done, almost]))).toMatchObject({
      percent: 99,
      complete: false,
    });
  });
});

describe("goal overview and completion", () => {
  it("reopens only a completed goal whose real item progress falls from full completion", () => {
    const before = defaultDb([]);
    before.tasks = [task({ done: true })];
    before.goals = [{ ...goal([createGoalItem(before, "task", "task-1", 1)]), status: "completed", completedAt: 1 }];
    const after = { ...before, tasks: [task({ done: false })] };
    expect(reopenRegressedGoals(before, after).goals[0]).toMatchObject({ status: "active", completedAt: null });
    expect(reopenRegressedGoals(before, before)).toBe(before);
  });

  it("does not reopen a manually completed partial goal or an empty goal", () => {
    const before = defaultDb([]);
    before.goals = [
      { ...goal([{ id: "partial", kind: "custom", title: "Read", measure: "count", target: 10, value: 5 }]), status: "completed", completedAt: 1 },
      { ...goal(), id: "empty", status: "completed", completedAt: 1 },
    ];
    const after = { ...before, goals: before.goals.map((goal) => ({ ...goal, items: goal.items.map((item) => ({ ...item, value: 4 })) })) } as typeof before;
    expect(reopenRegressedGoals(before, after)).toBe(after);
  });

  it("automatically completes active goals whose items are all complete", () => {
    const db = defaultDb([]);
    db.goals = [
      goal([
        { id: "done", kind: "custom", title: "Done", measure: "binary", value: true },
      ]),
    ];

    const completed = completeFullyProgressedGoals(db, 1234);

    expect(completed).not.toBe(db);
    expect(completed.goals[0]).toMatchObject({ status: "completed", completedAt: 1234 });
    expect(completeFullyProgressedGoals(completed, 9999)).toBe(completed);
  });

  it("summarizes total progress and active, completed, and overdue goals", () => {
    const db = defaultDb([]);
    db.goals = [
      goal([
        { id: "half", kind: "custom", title: "Half", measure: "count", value: 1, target: 2 },
      ]),
      { ...goal(), id: "late", deadlineAt: "2026-09-29T18:00" },
      { ...goal(), id: "done", status: "completed", completedAt: 2 },
    ];

    expect(goalOverview(db, new Date("2026-09-30T12:00:00").getTime())).toEqual({
      percent: 50,
      active: 2,
      completed: 1,
      overdue: 1,
      total: 3,
    });
  });

  it("reports remaining, overdue, and late-completed deadlines", () => {
    const due = "2026-10-03T12:00";
    const now = new Date("2026-10-01T12:00:00").getTime();
    expect(goalDeadlineState({ ...goal(), deadlineAt: due }, now)).toEqual({
      kind: "remaining",
      days: 2,
    });
    expect(goalDeadlineState({ ...goal(), deadlineAt: due }, new Date("2026-10-04T12:00:00").getTime())).toEqual({
      kind: "overdue",
      days: 1,
    });
    expect(
      goalDeadlineState(
        { ...goal(), status: "completed", deadlineAt: due, completedAt: new Date("2026-10-05T12:00:00").getTime() },
        now,
      ),
    ).toEqual({ kind: "completed-late", days: 2 });
  });

  it("returns only the highest newly crossed unseen milestone", () => {
    expect(highestCrossedGoalMilestone(49, 76, [])).toBe(75);
    expect(highestCrossedGoalMilestone(49, 100, [100])).toBe(75);
    expect(highestCrossedGoalMilestone(75, 100, [])).toBe(100);
    expect(highestCrossedGoalMilestone(80, 90, [])).toBeNull();
  });
});

describe("linkedGoalsForSource", () => {
  it("derives matching goals without storing a reverse relation", () => {
    const db = defaultDb([]);
    db.habits = [habit()];
    const item = createGoalItem(db, "habit", "habit-1", 10, new Date(2026, 8, 29).getTime());
    db.goals = [goal([item]), { ...goal([item]), id: "goal-2", title: "Marathon" }];

    expect(linkedGoalsForSource(db, "habit", "habit-1").map((entry) => entry.title)).toEqual([
      "Get fit",
      "Marathon",
    ]);
  });
});
