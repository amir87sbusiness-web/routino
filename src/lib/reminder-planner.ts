import type { LocalNotificationSchema } from "@capacitor/local-notifications";
import { addDays, dateKey, keyToDate } from "./dates";
import { isDueOn } from "./logic";
import type { Db, Habit } from "./store";

export interface ReminderPlanOptions {
  now: Date;
  productRemindersAllowed: boolean;
  lifecycleRemindersAllowed: boolean;
  rollingHorizonDays?: number;
  maxPending?: number;
}

export interface PlannedReminder {
  id: number;
  title: string;
  body: string;
  schedule: NonNullable<LocalNotificationSchema["schedule"]>;
  extra: {
    routino: true;
    category: "product" | "lifecycle";
    source: "habit" | "task" | "journal" | "subscription" | "trial";
    key: string;
  };
}

interface Candidate extends PlannedReminder {
  nextAt: number;
}

const DAY_MS = 86_400_000;
const DEFAULT_MAX_PENDING = 60;
const MAX_ROLLING_DAYS = 31;

export function routinoNotificationId(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
  }
  return hash & 0x7fffffff || 1;
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function atOnDate(dayKey: string, hour: number, minute: number): Date {
  const at = keyToDate(dayKey);
  at.setHours(hour, minute, 0, 0);
  return at;
}

function nextDailyAt(now: Date, hour: number, minute: number): Date {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

function candidate(
  key: string,
  title: string,
  body: string,
  schedule: PlannedReminder["schedule"],
  nextAt: Date,
  category: PlannedReminder["extra"]["category"],
  source: PlannedReminder["extra"]["source"],
): Candidate {
  return {
    id: routinoNotificationId(key),
    title,
    body,
    schedule,
    extra: { routino: true, category, source, key },
    nextAt: nextAt.getTime(),
  };
}

function habitCopy(db: Db, habit: Habit): { title: string; body: string } {
  const fa = db.settings.lang === "fa";
  return {
    title: fa ? "یادآوری عادت" : "Habit reminder",
    body: fa ? `وقتشه: ${habit.name}` : `Time for: ${habit.name}`,
  };
}

function nextWeekdayAt(now: Date, jsWeekday: number, hour: number, minute: number): Date {
  const next = new Date(now);
  const delta = (jsWeekday - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + delta);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);
  return next;
}

function addHabitCandidates(
  out: Candidate[],
  db: Db,
  habit: Habit,
  now: Date,
  horizonDays: number,
): void {
  if (habit.archived || !habit.reminderTime) return;
  const time = parseTime(habit.reminderTime);
  if (!time) return;
  const copy = habitCopy(db, habit);
  const today = dateKey(now);
  const createdDay = dateKey(new Date(habit.createdAt));

  if (habit.schedule.kind === "daily" && createdDay <= today) {
    const nextAt = nextDailyAt(now, time.hour, time.minute);
    if (!isDueOn(habit, dateKey(nextAt), db.settings.calendar)) return;
    const key = `habit|${habit.id}|daily|${habit.reminderTime}`;
    out.push(
      candidate(
        key,
        copy.title,
        copy.body,
        { on: { hour: time.hour, minute: time.minute }, allowWhileIdle: true },
        nextAt,
        "product",
        "habit",
      ),
    );
    return;
  }

  if (habit.schedule.kind === "weekdays" && createdDay <= today) {
    const weekdays = [...new Set(habit.schedule.weekdays ?? [])]
      .filter((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)
      .sort((a, b) => a - b);
    for (const weekday of weekdays) {
      const nextAt = nextWeekdayAt(now, weekday, time.hour, time.minute);
      if (!isDueOn(habit, dateKey(nextAt), db.settings.calendar)) continue;
      const key = `habit|${habit.id}|weekday|${weekday}|${habit.reminderTime}`;
      out.push(
        candidate(
          key,
          copy.title,
          copy.body,
          {
            on: {
              weekday: (weekday + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
              hour: time.hour,
              minute: time.minute,
            },
            allowWhileIdle: true,
          },
          nextAt,
          "product",
          "habit",
        ),
      );
    }
    return;
  }

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const dayKey = addDays(today, offset);
    if (!isDueOn(habit, dayKey, db.settings.calendar)) continue;
    const at = atOnDate(dayKey, time.hour, time.minute);
    if (at.getTime() <= now.getTime()) continue;
    const key = `habit|${habit.id}|${dayKey}|${habit.reminderTime}`;
    out.push(
      candidate(key, copy.title, copy.body, { at, allowWhileIdle: true }, at, "product", "habit"),
    );
  }
}

function addLifecycleCandidates(out: Candidate[], db: Db, now: Date): void {
  if (!db.auth || !db.subscription) return;
  const fa = db.settings.lang === "fa";
  const { expiresAt, trial } = db.subscription;
  const source = trial ? "trial" : "subscription";
  const prefix = trial ? "trial" : "subscription";
  const warningAt = expiresAt - (trial ? DAY_MS : 3 * DAY_MS);

  if (warningAt > now.getTime()) {
    const at = new Date(warningAt);
    const key = `${prefix}|expires-soon|${expiresAt}`;
    out.push(
      candidate(
        key,
        fa
          ? trial
            ? "یادآوری دوره آزمایشی روتینو"
            : "یادآوری اشتراک روتینو"
          : trial
            ? "Routino trial reminder"
            : "Routino subscription reminder",
        fa
          ? trial
            ? "یک روز تا پایان دوره آزمایشی‌ات باقی مانده است."
            : "سه روز تا پایان اشتراکت باقی مانده است."
          : trial
            ? "Your trial expires in one day."
            : "Your subscription expires in three days.",
        { at, allowWhileIdle: true },
        at,
        "lifecycle",
        source,
      ),
    );
  }

  if (expiresAt > now.getTime()) {
    const at = new Date(expiresAt);
    const key = `${prefix}|expired|${expiresAt}`;
    out.push(
      candidate(
        key,
        fa
          ? trial
            ? "دوره آزمایشی روتینو پایان یافت"
            : "اشتراک روتینو پایان یافت"
          : trial
            ? "Routino trial expired"
            : "Routino subscription expired",
        fa
          ? "دسترسی نوشتن پایان یافت؛ اطلاعات روی دستگاه و فضای ابری حسابت امن و قابل مشاهده می‌ماند."
          : "Write access ended; your data remains safe and readable on this device and in your account cloud.",
        { at, allowWhileIdle: true },
        at,
        "lifecycle",
        source,
      ),
    );
  }
}

export function planNativeReminders(db: Db, options: ReminderPlanOptions): PlannedReminder[] {
  const out: Candidate[] = [];
  const horizonDays = Math.min(
    MAX_ROLLING_DAYS,
    Math.max(1, Math.floor(options.rollingHorizonDays ?? MAX_ROLLING_DAYS)),
  );
  const maxPending = Math.min(
    DEFAULT_MAX_PENDING,
    Math.max(0, Math.floor(options.maxPending ?? DEFAULT_MAX_PENDING)),
  );

  if (options.productRemindersAllowed) {
    for (const habit of db.habits) addHabitCandidates(out, db, habit, options.now, horizonDays);

    const fa = db.settings.lang === "fa";
    for (const task of db.tasks) {
      if (task.done || !task.reminderAt) continue;
      const at = new Date(task.reminderAt);
      if (!Number.isFinite(at.getTime()) || at.getTime() <= options.now.getTime()) continue;
      const key = `task|${task.id}`;
      out.push(
        candidate(
          key,
          fa ? "یادآوری کار" : "Task reminder",
          task.title,
          { at, allowWhileIdle: true },
          at,
          "product",
          "task",
        ),
      );
    }

    if (db.settings.journalReminder) {
      const time = parseTime(db.settings.journalReminder);
      if (time) {
        const nextAt = nextDailyAt(options.now, time.hour, time.minute);
        out.push(
          candidate(
            "journal|daily",
            fa ? "ژورنال روتینو" : "Routino Journal",
            fa ? "وقت ژورنال‌نویسیه ✍️" : "Time to write your journal ✍️",
            { on: { hour: time.hour, minute: time.minute }, allowWhileIdle: true },
            nextAt,
            "product",
            "journal",
          ),
        );
      }
    }
  }

  if (options.lifecycleRemindersAllowed) addLifecycleCandidates(out, db, options.now);

  out.sort((a, b) => a.nextAt - b.nextAt || a.id - b.id);
  const unique = new Map<number, PlannedReminder>();
  for (const { nextAt: _nextAt, ...item } of out) {
    if (!unique.has(item.id)) unique.set(item.id, item);
    if (unique.size >= maxPending) break;
  }
  return [...unique.values()];
}
