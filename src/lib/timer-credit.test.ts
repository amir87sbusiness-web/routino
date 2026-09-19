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
});
