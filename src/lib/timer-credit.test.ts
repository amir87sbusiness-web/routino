import { describe, expect, it } from "vitest";
import { defaultDb, type TimerSession } from "./store";
import { recordTimerCompletion } from "./timer-credit";

describe("timer completion", () => {
  it("credits a linked task and session only once after replay", () => {
    const db = defaultDb([]);
    db.tasks = [
      {
        id: "task-1",
        dateKey: "2026-09-19",
        title: "Study",
        type: "quantity",
        target: 30,
        value: 0,
        done: false,
        unitKind: "time",
      },
    ];
    const item = {
      id: "timer-1:free",
      mode: "free" as const,
      focusSeconds: 60,
      startedAt: 1_000,
      endedAt: 61_000,
      linked: { kind: "task" as const, id: "task-1", label: "Study" },
    };
    const first = recordTimerCompletion(db, item, "gregorian");
    const replayed = recordTimerCompletion(first, item, "gregorian");
    expect(replayed.tasks[0].value).toBe(1);
    expect(replayed.timerSessions).toHaveLength(1);
    expect(replayed.timerSessions[0]).toMatchObject({
      id: "timer-1:free",
      focusSeconds: 60,
      linkedId: "task-1",
    } satisfies Partial<TimerSession>);
    expect(replayed.timerSessions[0]).not.toHaveProperty("linkedItemId");
  });

  it("records a session but does not credit a habit after its deadline", () => {
    const db = defaultDb([]);
    db.habits = [
      {
        id: "habit-1",
        name: "Study",
        categoryId: "study",
        type: "quantity",
        target: 30,
        unitKind: "time",
        schedule: { kind: "daily" },
        monthlyGoal: null,
        reminderTime: null,
        deadlineTime: "18:30",
        createdAt: 0,
      },
    ];
    const item = {
      id: "timer-after-deadline",
      mode: "free" as const,
      focusSeconds: 60,
      startedAt: new Date(2026, 8, 20, 18, 30).getTime(),
      endedAt: new Date(2026, 8, 20, 18, 31).getTime(),
      linked: { kind: "habit" as const, id: "habit-1", label: "Study" },
    };

    const next = recordTimerCompletion(db, item, "gregorian");
    expect(next.logs).toEqual({});
    expect(next.timerSessions).toHaveLength(1);
  });

  it("credits only the linked custom time goal item once and keeps its real value past target", () => {
    const db = defaultDb([]);
    db.goals = [
      {
        id: "goal-1",
        title: "تمرکز",
        priority: "normal",
        status: "active",
        createdAt: 1,
        items: [
          {
            id: "goal-time-1",
            kind: "custom",
            title: "مطالعه",
            measure: "time",
            valueMinutes: 59.5,
            targetMinutes: 60,
          },
          {
            id: "goal-count-1",
            kind: "custom",
            title: "فصل",
            measure: "count",
            value: 1,
            target: 3,
          },
        ],
      },
    ];
    const item = {
      id: "timer-goal-1",
      mode: "free" as const,
      focusSeconds: 90,
      startedAt: 1_000,
      endedAt: 91_000,
      linked: {
        kind: "goal" as const,
        id: "goal-1",
        itemId: "goal-time-1",
        label: "تمرکز · مطالعه",
      },
    };

    const first = recordTimerCompletion(db, item, "gregorian");
    const replayed = recordTimerCompletion(first, item, "gregorian");

    expect(first.goals[0].items).toEqual([
      expect.objectContaining({ id: "goal-time-1", valueMinutes: 61 }),
      db.goals[0].items[1],
    ]);
    expect(replayed).toBe(first);
    expect(first.timerSessions).toEqual([
      expect.objectContaining({
        id: "timer-goal-1",
        linkedKind: "goal",
        linkedId: "goal-1",
        linkedItemId: "goal-time-1",
      }),
    ]);
  });

  it("records but does not directly credit a missing or source-linked goal item", () => {
    const db = defaultDb([]);
    db.goals = [
      {
        id: "goal-1",
        title: "تمرکز",
        priority: "normal",
        status: "active",
        createdAt: 1,
        items: [
          {
            id: "goal-source-1",
            kind: "source",
            sourceType: "habit",
            sourceId: "habit-1",
            sourceTitleSnapshot: "مطالعه",
            measure: "time",
            target: 60,
            linkedAt: 1,
            linkedDateKey: "2026-09-30",
            baselineValue: 0,
          },
        ],
      },
    ];

    const next = recordTimerCompletion(
      db,
      {
        id: "timer-goal-source",
        mode: "free",
        focusSeconds: 60,
        startedAt: 1_000,
        endedAt: 61_000,
        linked: {
          kind: "goal",
          id: "goal-1",
          itemId: "goal-source-1",
          label: "تمرکز · مطالعه",
        },
      },
      "gregorian",
    );

    expect(next.goals).toEqual(db.goals);
    expect(next.timerSessions).toHaveLength(1);
  });
});
