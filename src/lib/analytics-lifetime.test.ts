import { describe, expect, it } from "vitest";
import { monthDays } from "./dates";
import { formatCompactValue, habitLifetimeStats, taskMonthAnalytics } from "./analytics";
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb, logKey, type Habit, type Task } from "./store";

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: "habit-1",
  name: "Study",
  categoryId: "c1",
  type: "quantity",
  target: 30,
  unitKind: "time",
  schedule: { kind: "daily" },
  monthlyGoal: null,
  reminderTime: null,
  createdAt: new Date("2026-01-01T00:00:00").getTime(),
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: "task-1",
  dateKey: "2026-07-05",
  title: "Ship",
  type: "binary",
  target: 1,
  value: 0,
  done: false,
  ...over,
});

describe("habitLifetimeStats", () => {
  it("finds the longest run across scheduled days, not calendar days", () => {
    const h = habit({
      type: "binary",
      target: 1,
      unitKind: undefined,
      schedule: { kind: "weekdays", weekdays: [1, 3] },
    });
    const db = defaultDb(DEFAULT_CATEGORIES);
    db.habits = [h];
    for (const dateKey of ["2026-07-01", "2026-07-06", "2026-07-08", "2026-07-15"]) {
      db.logs[logKey(h.id, dateKey)] = {
        habitId: h.id,
        dateKey,
        value: 1,
        done: true,
      };
    }

    expect(habitLifetimeStats(db, h, "gregorian", "2026-07-15").longestStreak).toBe(3);
  });

  it("sums all recorded quantity, including partial days", () => {
    const h = habit();
    const db = defaultDb(DEFAULT_CATEGORIES);
    db.habits = [h];
    db.logs[logKey(h.id, "2026-07-01")] = {
      habitId: h.id,
      dateKey: "2026-07-01",
      value: 45,
      done: true,
    };
    db.logs[logKey(h.id, "2026-07-02")] = {
      habitId: h.id,
      dateKey: "2026-07-02",
      value: 20,
      done: false,
    };

    expect(habitLifetimeStats(db, h, "gregorian", "2026-07-02").totalValue).toBe(65);
  });
});

describe("formatCompactValue", () => {
  it("keeps small values exact and shortens thousands with K", () => {
    expect(formatCompactValue(999, "en")).toBe("999");
    expect(formatCompactValue(1_000, "en")).toBe("1K");
    expect(formatCompactValue(1_250, "en")).toBe("1.3K");
    expect(formatCompactValue(12_000, "fa")).toBe("۱۲K");
  });
});

describe("taskMonthAnalytics", () => {
  it("returns one completion percentage per month day and leaves empty/future days blank", () => {
    const db = defaultDb(DEFAULT_CATEGORIES);
    db.tasks = [
      task({ id: "done", dateKey: "2026-07-05", done: true, value: 1 }),
      task({ id: "open", dateKey: "2026-07-05" }),
      task({ id: "done-next", dateKey: "2026-07-06", done: true, value: 1 }),
    ];

    const result = taskMonthAnalytics(db.tasks, "2026-07-01", "gregorian", {
      today: "2026-07-10",
      now: new Date("2026-07-10T12:00:00"),
    });

    expect(result.series.find((day) => day.dateKey === "2026-07-05")?.percent).toBe(50);
    expect(result.series.find((day) => day.dateKey === "2026-07-06")?.percent).toBe(100);
    expect(result.series.find((day) => day.dateKey === "2026-07-07")?.percent).toBeNull();
    expect(result.series.find((day) => day.dateKey === "2026-07-11")?.percent).toBeNull();
    expect(result.series).toHaveLength(monthDays("2026-07-01", "gregorian").length);
  });

  it("classifies unfinished expired deadlines as overdue while completed work stays done", () => {
    const db = defaultDb(DEFAULT_CATEGORIES);
    db.tasks = [
      task({ id: "done", done: true, value: 1, deadlineAt: "2026-07-05T09:00" }),
      task({ id: "overdue", deadlineAt: "2026-07-09T18:00" }),
      task({ id: "pending", deadlineAt: "2026-07-12T18:00" }),
      task({ id: "legacy" }),
      task({ id: "outside", dateKey: "2026-08-01" }),
    ];

    const result = taskMonthAnalytics(db.tasks, "2026-07-01", "gregorian", {
      today: "2026-07-10",
      now: new Date("2026-07-10T12:00:00"),
    });

    expect(result.items.map(({ task: item, status }) => [item.id, status])).toEqual([
      ["done", "done"],
      ["overdue", "overdue"],
      ["pending", "pending"],
      ["legacy", "pending"],
    ]);
  });
});
