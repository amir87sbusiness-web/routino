/**
 * The numbers on the Analytics screen.
 *
 * These are the only claims the app makes about how the user is doing, so a
 * wrong one is worse than no chart at all. The week comparison in particular
 * used to include TODAY — a day that is only a few hours old — on the "this
 * week" side while the other side was made of finished days, so it announced a
 * decline every morning.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildChartBars } from "./chart";
import { addDays, weekStartOf, type Calendar } from "./dates";
import {
  avgOf,
  cappedPercent,
  dayScore,
  monthProgress,
  streak,
  successRate,
  weekComparison,
  weeklyReview,
} from "./logic";
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb, logKey, type Db, type Habit, type HabitLog, type Task } from "./store";

/** A Wednesday in both calendars, so "first day of the week" never triggers by
 * accident and the Jalali (Sat) and Gregorian (Sun) week starts both fall
 * mid-history. */
const TODAY = "2026-07-15";

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});

afterAll(() => vi.useRealTimers());

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: "h1",
  name: "Read",
  categoryId: "c1",
  type: "binary",
  target: 1,
  schedule: { kind: "daily" },
  monthlyGoal: null,
  reminderTime: null,
  // Old enough that `isDueOn` never rejects a day for predating the habit.
  createdAt: Date.parse("2020-01-01T00:00:00Z"),
  ...over,
});

/** A Db whose logs mark `done` on exactly the given day-keys. */
function dbWith(habits: Habit[], doneKeys: string[], partial: Record<string, number> = {}): Db {
  const base = defaultDb(DEFAULT_CATEGORIES);
  const logs: Record<string, HabitLog> = {};
  for (const h of habits) {
    for (const dk of doneKeys) {
      logs[logKey(h.id, dk)] = { habitId: h.id, dateKey: dk, value: h.target, done: true };
    }
    for (const [dk, value] of Object.entries(partial)) {
      logs[logKey(h.id, dk)] = { habitId: h.id, dateKey: dk, value, done: false };
    }
  }
  return { ...base, habits, logs };
}

/** The `days` day-keys ending the day before `TODAY`, i.e. this week so far. */
const daysBefore = (today: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => addDays(today, -(n - i)));

function oneYearTaskFixture(): Task[] {
  return Array.from({ length: 365 * 10 }, (_, index) => {
    const dateKey = addDays("2025-01-01", Math.floor(index / 10));
    return {
      id: `task-${index}`,
      dateKey,
      title: index % 2 === 0 ? `مطالعه ${index}` : `کار ${index}`,
      type: "binary",
      target: 1,
      value: 1,
      done: true,
    };
  });
}

describe("dayScore", () => {
  it("is unchanged when an identical task year originated from archive expansion", () => {
    const beforeDb = dbWith([habit()], [TODAY]);
    beforeDb.tasks = oneYearTaskFixture();
    const afterDb: Db = {
      ...beforeDb,
      tasks: beforeDb.tasks.map((task) => ({ ...task })),
    };

    expect(afterDb.tasks).toEqual(beforeDb.tasks);
    expect(dayScore(afterDb, TODAY, "gregorian")).toBe(dayScore(beforeDb, TODAY, "gregorian"));
  });

  it("is null when nothing is due, not zero", () => {
    // A day with no habits is not a 0% day — it must drop out of every average
    // rather than dragging it down.
    const db = dbWith([habit({ schedule: { kind: "weekdays", weekdays: [1] } })], []);
    const sunday = "2026-07-12"; // getDay() === 0
    expect(dayScore(db, sunday, "gregorian")).toBeNull();
  });

  it("averages capped completion across due habits", () => {
    const db = dbWith([habit({ id: "a" }), habit({ id: "b" })], []);
    db.logs[logKey("a", TODAY)] = { habitId: "a", dateKey: TODAY, value: 1, done: true };
    expect(dayScore(db, TODAY, "gregorian")).toBe(50); // one of two
  });

  it("never lets an over-achieved habit exceed 100", () => {
    const h = habit({ type: "quantity", target: 10 });
    const db = dbWith([h], [], { [TODAY]: 40 });
    expect(cappedPercent(h, db.logs[logKey(h.id, TODAY)])).toBe(100);
    expect(dayScore(db, TODAY, "gregorian")).toBe(100);
  });
});

describe("weekComparison", () => {
  for (const cal of ["jalali", "gregorian"] as const) {
    it(`excludes today from both sides (${cal})`, () => {
      const start = weekStartOf(TODAY, cal);
      const elapsed: string[] = [];
      for (let d = start; d < TODAY; d = addDays(d, 1)) elapsed.push(d);

      // Every finished day this week done, every matching day last week done,
      // and today deliberately left empty. If today counted, `cur` would drop.
      const lastWeek = elapsed.map((d) => addDays(d, -7));
      const db = dbWith([habit()], [...elapsed, ...lastWeek]);

      const wc = weekComparison(db, cal, TODAY);
      expect(wc.days).toBe(elapsed.length);
      expect(wc.cur).toBe(100);
      expect(wc.prev).toBe(100);
      expect(wc.delta).toBe(0);
      expect(wc.scope).toBe("week-to-date");
    });
  }

  it("compares equal spans, never 3 days against 7", () => {
    const cal: Calendar = "gregorian";
    // Gregorian week starts Sunday; 2026-07-15 is a Wednesday → 3 finished days.
    const wc = weekComparison(dbWith([habit()], []), cal, TODAY);
    expect(wc.days).toBe(3);
  });

  it("says 'not comparable' instead of inventing a gain against a week that never happened", () => {
    const cal: Calendar = "gregorian";
    const start = weekStartOf(TODAY, cal);
    const elapsed: string[] = [];
    for (let d = start; d < TODAY; d = addDays(d, 1)) elapsed.push(d);
    // Habit created this week: last week has no due day at all.
    const created = new Date(`${start}T00:00:00`).getTime();
    const db = dbWith([habit({ createdAt: created })], elapsed);

    const wc = weekComparison(db, cal, TODAY);
    expect(wc.cur).toBe(100);
    expect(wc.prev).toBe(0);
    expect(wc.comparable).toBe(false);
  });

  it("reports a real decline in percentage points", () => {
    const cal: Calendar = "gregorian";
    const start = weekStartOf(TODAY, cal);
    const elapsed: string[] = [];
    for (let d = start; d < TODAY; d = addDays(d, 1)) elapsed.push(d);
    const lastWeek = elapsed.map((d) => addDays(d, -7));
    // Two habits: last week both done, this week only one → 100% vs 50%.
    const db = dbWith([habit({ id: "a" }), habit({ id: "b" })], lastWeek);
    for (const dk of elapsed)
      db.logs[logKey("a", dk)] = { habitId: "a", dateKey: dk, value: 1, done: true };

    const wc = weekComparison(db, cal, TODAY);
    expect(wc.prev).toBe(100);
    expect(wc.cur).toBe(50);
    expect(wc.delta).toBe(-50);
    expect(wc.comparable).toBe(true);
  });

  it("falls back to the two completed weeks on the first day of a week", () => {
    const cal: Calendar = "gregorian";
    const sunday = "2026-07-12"; // week start in Gregorian
    expect(weekStartOf(sunday, cal)).toBe(sunday);

    const lastWeek = daysBefore(sunday, 7);
    const db = dbWith([habit()], lastWeek);
    const wc = weekComparison(db, cal, sunday);
    expect(wc.scope).toBe("last-week");
    expect(wc.days).toBe(7);
    expect(wc.cur).toBe(100); // the 7 days before today
    expect(wc.prev).toBe(0); // the 7 before those
    expect(wc.comparable).toBe(true);
  });
});

describe("weeklyReview", () => {
  it("summarizes the same completed week span without counting unfinished today", () => {
    const a = habit({ id: "a", name: "Read" });
    const b = habit({ id: "b", name: "Walk" });
    const current = ["2026-07-12", "2026-07-13", "2026-07-14"];
    const previous = ["2026-07-05", "2026-07-06", "2026-07-07"];
    const db = dbWith([a, b], []);

    for (const dk of [...current, ...previous]) {
      db.logs[logKey("a", dk)] = { habitId: "a", dateKey: dk, value: 1, done: true };
    }
    for (const dk of [...current.slice(0, 2), ...previous]) {
      db.logs[logKey("b", dk)] = { habitId: "b", dateKey: dk, value: 1, done: true };
    }

    const review = weeklyReview(db, "gregorian", TODAY);
    expect(review).toMatchObject({
      completionPercent: 83,
      previousPercent: 100,
      changePoints: -17,
      completedCheckIns: 5,
      activeDays: 3,
      days: 3,
      strongestDay: { dateKey: "2026-07-12", percent: 100 },
      weakestDay: { dateKey: "2026-07-14", percent: 50 },
      mostConsistentHabit: { id: "a", completed: 3, opportunities: 3, rate: 100 },
      mostMissedHabit: { id: "b", missed: 1, opportunities: 3, rate: 67 },
      consistencySignal: { id: "a", streak: 3 },
    });
  });

  it("returns no review when fewer than two finished days had due habits", () => {
    const sundayOnly = habit({ schedule: { kind: "weekdays", weekdays: [0] } });
    const db = dbWith([sundayOnly], ["2026-07-12"]);
    expect(weeklyReview(db, "gregorian", TODAY)).toBeNull();
  });

  it("does not invent a comparison or habit insight from insufficient history", () => {
    const createdThisWeek = habit({ createdAt: new Date("2026-07-12T00:00:00").getTime() });
    const db = dbWith([createdThisWeek], ["2026-07-12", "2026-07-13", "2026-07-14"]);
    const review = weeklyReview(db, "gregorian", TODAY);

    expect(review?.completionPercent).toBe(100);
    expect(review?.previousPercent).toBeNull();
    expect(review?.changePoints).toBeNull();
    expect(review?.mostConsistentHabit).toMatchObject({ name: "Read", opportunities: 3 });
    expect(review?.mostMissedHabit).toBeNull();
  });

  for (const cal of ["jalali", "gregorian"] as const) {
    it(`keeps ${cal} week scope identical to weekComparison`, () => {
      const db = dbWith([habit()], daysBefore(TODAY, 14));
      const review = weeklyReview(db, cal, TODAY);
      const comparison = weekComparison(db, cal, TODAY);
      expect(review).toMatchObject({
        completionPercent: comparison.cur,
        previousPercent: comparison.prev,
        changePoints: comparison.delta,
        days: comparison.days,
        scope: comparison.scope,
      });
    });
  }
});

describe("streak / successRate / monthProgress", () => {
  it("streak counts back from yesterday when today is not done yet", () => {
    const h = habit();
    const db = dbWith([h], daysBefore(TODAY, 4));
    // Today untouched: the chain of 4 finished days still stands.
    expect(streak(db, h, "gregorian")).toBe(4);
  });

  it("streak includes today once it is done", () => {
    const h = habit();
    const db = dbWith([h], [...daysBefore(TODAY, 4), TODAY]);
    expect(streak(db, h, "gregorian")).toBe(5);
  });

  it("successRate divides by DUE days, not calendar days", () => {
    // Due only on Wednesdays (getDay() === 3). Over a 14-day window that is 2
    // due days; completing one of them is 50%, not 1/14.
    const h = habit({ schedule: { kind: "weekdays", weekdays: [3] } });
    const db = dbWith([h], [TODAY]); // TODAY is a Wednesday
    expect(successRate(db, h, "gregorian", 14)).toBe(50);
  });

  it("monthProgress measures against the monthly goal, capped at 100", () => {
    const h = habit({ monthlyGoal: 10 });
    const db = dbWith([h], daysBefore(TODAY, 5));
    const p = monthProgress(db, h, "gregorian", TODAY);
    expect(p.goalDays).toBe(10);
    expect(p.doneDays).toBe(5);
    expect(p.percent).toBe(50);

    const over = dbWith([habit({ monthlyGoal: 3 })], daysBefore(TODAY, 5));
    expect(monthProgress(over, over.habits[0], "gregorian", TODAY).percent).toBe(100);
  });
});

describe("avgOf", () => {
  it("ignores null days rather than treating them as zero", () => {
    expect(avgOf([{ percent: 100 }, { percent: null }, { percent: 50 }])).toBe(75);
  });

  it("is 0 for a series with nothing in it", () => {
    expect(avgOf([])).toBe(0);
    expect(avgOf([{ percent: null }])).toBe(0);
  });
});

describe("buildChartBars averaging", () => {
  it("a quarter bucket is the mean of its 7 days, ignoring empty ones", () => {
    const keys = Array.from({ length: 91 }, (_, i) => addDays("2026-04-16", i));
    const series = keys.map((dateKey, i) => ({
      dateKey,
      // First week: 100, 0, then nulls → mean 50, not 100/7.
      percent: i < 7 ? (i === 0 ? 100 : i === 1 ? 0 : null) : null,
    }));
    const { buckets } = buildChartBars(series, "quarter", "gregorian", "fa");
    expect(buckets[0]).toBe(50);
    expect(buckets[1]).toBeNull();
  });
});
