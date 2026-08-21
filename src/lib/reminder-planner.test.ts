import { describe, expect, it } from "vitest";
import { dateKey } from "./dates";
import { DEFAULT_CATEGORIES } from "./presets";
import { planNativeReminders, routinoNotificationId } from "./reminder-planner";
import { defaultDb, type Db, type Habit, type Task } from "./store";

const NOW = new Date(2026, 7, 17, 6, 0, 0, 0); // Monday, 2026-08-17

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "habit-1",
    name: "Read",
    categoryId: "health",
    type: "binary",
    target: 1,
    schedule: { kind: "daily" },
    monthlyGoal: null,
    reminderTime: "09:15",
    createdAt: new Date(2026, 7, 1, 12).getTime(),
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    dateKey: "2026-08-18",
    title: "Call",
    type: "binary",
    target: 1,
    value: 0,
    done: false,
    reminderAt: "2026-08-18T08:00",
    ...overrides,
  };
}

function db(): Db {
  const value = defaultDb(DEFAULT_CATEGORIES);
  value.settings.lang = "en";
  value.settings.calendar = "gregorian";
  value.settings.notificationsEnabled = true;
  value.settings.journalReminder = null;
  value.auth = { userId: "user-1", phone: "989120000000", verifiedAt: NOW.getTime() };
  return value;
}

function plan(value: Db, extra: Partial<Parameters<typeof planNativeReminders>[1]> = {}) {
  return planNativeReminders(value, {
    now: NOW,
    productRemindersAllowed: true,
    lifecycleRemindersAllowed: true,
    rollingHorizonDays: 8,
    maxPending: 60,
    ...extra,
  });
}

function habitDates(value: Db): string[] {
  return plan(value)
    .filter((item) => item.extra.source === "habit" && item.schedule.at)
    .map((item) => dateKey(item.schedule.at!));
}

describe("planNativeReminders", () => {
  it("uses one native daily recurrence for a daily habit", () => {
    const value = db();
    value.habits = [habit({ id: "remote-habit" })];

    const [item] = plan(value);

    expect(item.extra.key).toBe("habit|remote-habit|daily|09:15");
    expect(item.schedule).toEqual({ on: { hour: 9, minute: 15 }, allowWhileIdle: true });
  });

  it("uses only the selected native weekdays", () => {
    const value = db();
    value.habits = [habit({ schedule: { kind: "weekdays", weekdays: [1, 3] } })];

    const items = plan(value);

    expect(items.map((item) => item.schedule.on?.weekday)).toEqual([2, 4]);
    expect(items.map((item) => item.extra.key)).toEqual([
      "habit|habit-1|weekday|1|09:15",
      "habit|habit-1|weekday|3|09:15",
    ]);
  });

  it("plans Gregorian odd and even dates from Gregorian day-of-month", () => {
    const oddDb = db();
    oddDb.habits = [habit({ schedule: { kind: "odd" } })];
    const evenDb = db();
    evenDb.habits = [habit({ schedule: { kind: "even" } })];

    expect(habitDates(oddDb)).toEqual(["2026-08-17", "2026-08-19", "2026-08-21", "2026-08-23"]);
    expect(habitDates(evenDb)).toEqual(["2026-08-18", "2026-08-20", "2026-08-22", "2026-08-24"]);
  });

  it("plans Jalali odd and even dates across a Jalali month boundary", () => {
    const oddDb = db();
    oddDb.settings.calendar = "jalali";
    oddDb.habits = [habit({ schedule: { kind: "odd" } })];
    const evenDb = db();
    evenDb.settings.calendar = "jalali";
    evenDb.habits = [habit({ schedule: { kind: "even" } })];

    expect(habitDates(oddDb)).toEqual(["2026-08-18", "2026-08-20", "2026-08-22", "2026-08-23"]);
    expect(habitDates(evenDb)).toEqual(["2026-08-17", "2026-08-19", "2026-08-21", "2026-08-24"]);
  });

  it("never plans an occurrence before habit createdAt", () => {
    const value = db();
    value.settings.calendar = "jalali";
    value.habits = [
      habit({ schedule: { kind: "odd" }, createdAt: new Date(2026, 7, 21, 12).getTime() }),
    ];

    expect(habitDates(value)).toEqual(["2026-08-22", "2026-08-23"]);
  });

  it("omits archived habits and habits whose reminder was removed", () => {
    const value = db();
    value.habits = [
      habit({ id: "archived", archived: true }),
      habit({ id: "silent", reminderTime: null }),
    ];

    expect(plan(value)).toEqual([]);
  });

  it("changes the habit occurrence id and schedule when reminder time changes", () => {
    const value = db();
    value.habits = [habit({ reminderTime: "08:00" })];
    const before = plan(value)[0];
    value.habits = [habit({ reminderTime: "10:30" })];
    const after = plan(value)[0];

    expect(before.schedule.on).toEqual({ hour: 8, minute: 0 });
    expect(after.schedule.on).toEqual({ hour: 10, minute: 30 });
    expect(after.id).not.toBe(before.id);
  });

  it("derives task create, edit, complete, delete and past behavior from state", () => {
    const value = db();
    value.tasks = [task()];
    const created = plan(value);
    value.tasks = [task({ reminderAt: "2026-08-18T10:30" })];
    const edited = plan(value);

    expect(created[0].extra.key).toBe("task|task-1");
    expect(created[0].schedule.at).toEqual(new Date(2026, 7, 18, 8, 0));
    expect(edited[0].id).toBe(created[0].id);
    expect(edited[0].schedule.at).toEqual(new Date(2026, 7, 18, 10, 30));

    value.tasks = [task({ done: true })];
    expect(plan(value)).toEqual([]);
    value.tasks = [task({ reminderAt: "2026-08-17T05:59" })];
    expect(plan(value)).toEqual([]);
    value.tasks = [];
    expect(plan(value)).toEqual([]);
  });

  it("updates the deterministic journal schedule when its time changes", () => {
    const value = db();
    value.settings.journalReminder = "21:10";
    const first = plan(value)[0];
    value.settings.journalReminder = "22:20";
    const edited = plan(value)[0];

    expect(first.extra.key).toBe("journal|daily");
    expect(first.id).toBe(edited.id);
    expect(first.schedule.on).toEqual({ hour: 21, minute: 10 });
    expect(edited.schedule.on).toEqual({ hour: 22, minute: 20 });
  });

  it("keeps lifecycle reminders when product reminders are disabled", () => {
    const value = db();
    value.habits = [habit()];
    value.tasks = [task()];
    value.settings.journalReminder = "21:00";
    value.subscription = {
      planId: "trial",
      trial: true,
      startedAt: NOW.getTime(),
      expiresAt: new Date(2026, 7, 24, 6).getTime(),
    };

    const items = plan(value, { productRemindersAllowed: false });

    expect(items.map((item) => item.extra.key)).toEqual([
      `trial|expires-soon|${new Date(2026, 7, 24, 6).getTime()}`,
      `trial|expired|${new Date(2026, 7, 24, 6).getTime()}`,
    ]);
    expect(items.every((item) => item.extra.category === "lifecycle")).toBe(true);
  });

  it("returns closest unique reminders first within the native capacity", () => {
    const value = db();
    value.settings.journalReminder = null;
    value.habits = [habit({ schedule: { kind: "odd" }, reminderTime: "09:00" })];
    value.tasks = [task({ id: "near", reminderAt: "2026-08-17T07:00" })];

    const items = plan(value, { maxPending: 3 });

    expect(items.map((item) => item.extra.key)).toEqual([
      "task|near",
      "habit|habit-1|2026-08-17|09:00",
      "habit|habit-1|2026-08-19|09:00",
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("produces stable positive Android-safe IDs", () => {
    const first = routinoNotificationId("habit|stable|daily|08:00");
    expect(first).toBe(routinoNotificationId("habit|stable|daily|08:00"));
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(2_147_483_647);
  });

  it("enforces the realistic 60-request ceiling even when a larger limit is requested", () => {
    const value = db();
    value.tasks = Array.from({ length: 80 }, (_, index) =>
      task({
        id: `task-${index}`,
        reminderAt: new Date(2026, 7, 18, 8, index % 60).toISOString(),
      }),
    );

    expect(plan(value, { maxPending: 100 })).toHaveLength(60);
  });
});
