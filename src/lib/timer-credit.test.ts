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
});
