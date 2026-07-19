/**
 * ═══════════════ TEST-ONLY — بعداً حذف شود ═══════════════
 * One year of realistic fake data, for testing every screen against a "real"
 * long-lived account: habits with different schedules/types, ~۷۵٪ completion
 * with weekly rhythm and an improving trend, journal entries with moods,
 * finished/pending tasks, and months of timer sessions.
 *
 * Deterministic (seeded PRNG): seeding twice produces identical data, so a bug
 * seen once can be reproduced. Used by the TEST-ONLY button in Settings, which
 * REPLACES current content (wipeContent first, then this).
 */
import { addDays, todayKey } from "./dates";
import { MOOD_EMOJIS } from "./presets";
import { logKey, type Db, type Habit, type HabitLog, type JournalEntry, type Task, type TimerSession } from "./store";

/** Mulberry32 — tiny deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS = 365;

interface DemoHabitSpec {
  name: string;
  categoryId: string;
  type: "binary" | "quantity";
  target: number;
  unit?: string;
  unitKind?: "count" | "time";
  schedule: Habit["schedule"];
  monthlyGoal: number | null;
  reminderTime: string | null;
  /** Base chance of doing it on a due day. */
  rate: number;
  /** Days ago it was created (365 = full year). */
  ageDays: number;
}

const SPECS: DemoHabitSpec[] = [
  { name: "ورزش روزانه", categoryId: "sport", type: "quantity", target: 30, unitKind: "time", schedule: { kind: "daily" }, monthlyGoal: 22, reminderTime: "18:00", rate: 0.72, ageDays: DAYS },
  { name: "مطالعه", categoryId: "study", type: "quantity", target: 20, unitKind: "time", schedule: { kind: "daily" }, monthlyGoal: null, reminderTime: "21:30", rate: 0.8, ageDays: DAYS },
  { name: "نوشیدن آب", categoryId: "health", type: "quantity", target: 8, unit: "لیوان", unitKind: "count", schedule: { kind: "daily" }, monthlyGoal: null, reminderTime: null, rate: 0.85, ageDays: DAYS },
  { name: "بیدار شدن قبل از ۷", categoryId: "morning", type: "binary", target: 1, schedule: { kind: "daily" }, monthlyGoal: 20, reminderTime: "06:45", rate: 0.6, ageDays: 300 },
  { name: "مدیتیشن", categoryId: "growth", type: "quantity", target: 10, unitKind: "time", schedule: { kind: "odd" }, monthlyGoal: null, reminderTime: null, rate: 0.65, ageDays: 240 },
  { name: "زبان انگلیسی", categoryId: "study", type: "quantity", target: 15, unitKind: "time", schedule: { kind: "weekdays", weekdays: [0, 1, 2, 3, 6] }, monthlyGoal: null, reminderTime: "20:00", rate: 0.7, ageDays: 200 },
  { name: "پیاده‌روی", categoryId: "health", type: "binary", target: 1, schedule: { kind: "weekdays", weekdays: [1, 3, 5] }, monthlyGoal: null, reminderTime: null, rate: 0.75, ageDays: 150 },
  { name: "بدون فست‌فود", categoryId: "limits", type: "binary", target: 1, schedule: { kind: "daily" }, monthlyGoal: 25, reminderTime: null, rate: 0.8, ageDays: 90 },
];

const TASK_TITLES = [
  "خرید هفتگی",
  "پرداخت قبض برق",
  "تماس با دکتر",
  "تمیز کردن اتاق",
  "ارسال ایمیل کاری",
  "تعویض روغن ماشین",
  "خرید کادو تولد",
  "رزرو بلیت سفر",
  "تمرین پروژه",
  "مرتب کردن کمد",
];

const JOURNAL_LINES = [
  "روز پرکاری بود ولی به بیشتر کارهام رسیدم.",
  "امروز حس خوبی داشتم، ورزش حالمو بهتر کرد.",
  "خسته بودم و تمرکزم کم بود.",
  "با دوستام بیرون رفتم و کلی خندیدیم.",
  "یه قدم کوچیک ولی مهم به سمت هدفم برداشتم.",
  "روز آرومی بود، بیشتر استراحت کردم.",
  "کارها روی هم تلنبار شده، باید برنامه‌ریزی کنم.",
  "کتاب خوبی شروع کردم و کلی ایده گرفتم.",
];

/** Is `dk` a due day for the spec (mirror of logic.isDueOn, without needing a Db). */
function due(spec: DemoHabitSpec, dk: string, dayOffset: number): boolean {
  const d = new Date(dk + "T00:00:00");
  if (dayOffset > spec.ageDays) return false;
  const s = spec.schedule;
  if (s.kind === "daily") return true;
  if (s.kind === "odd") return d.getDate() % 2 === 1;
  if (s.kind === "even") return d.getDate() % 2 === 0;
  if (s.kind === "weekdays") return (s.weekdays ?? []).includes(d.getDay());
  return true;
}

export interface DemoContent {
  habits: Habit[];
  logs: Record<string, HabitLog>;
  tasks: Task[];
  timerSessions: TimerSession[];
  journal: Record<string, JournalEntry>;
}

export function buildDemoContent(now = Date.now()): DemoContent {
  const rand = rng(1404);
  const today = todayKey();
  const dayMs = 24 * 60 * 60 * 1000;

  const habits: Habit[] = SPECS.map((s, i) => ({
    id: `demo-h${i + 1}`,
    name: s.name,
    categoryId: s.categoryId,
    type: s.type,
    target: s.target,
    unit: s.unit,
    unitKind: s.type === "quantity" ? (s.unitKind ?? "count") : undefined,
    schedule: s.schedule,
    monthlyGoal: s.monthlyGoal,
    reminderTime: s.reminderTime,
    createdAt: now - s.ageDays * dayMs,
  }));

  const logs: Record<string, HabitLog> = {};
  for (let off = DAYS; off >= 0; off--) {
    const dk = addDays(today, -off);
    // Weekly rhythm (weekends dip) + slow improvement over the year.
    const d = new Date(dk + "T00:00:00");
    const weekend = d.getDay() === 5; // جمعه
    const trend = ((DAYS - off) / DAYS) * 0.15; // up to +15% by "now"
    for (let i = 0; i < SPECS.length; i++) {
      const spec = SPECS[i];
      if (!due(spec, dk, off)) continue;
      const p = Math.min(0.97, spec.rate + trend - (weekend ? 0.15 : 0));
      if (rand() >= p) continue;
      const full = rand() < 0.85; // sometimes only partial progress
      const value =
        spec.type === "binary"
          ? 1
          : full
            ? spec.target
            : Math.max(1, Math.round(spec.target * (0.3 + rand() * 0.5)));
      logs[logKey(`demo-h${i + 1}`, dk)] = {
        habitId: `demo-h${i + 1}`,
        dateKey: dk,
        value,
        done: spec.type === "binary" ? true : value >= spec.target,
      };
    }
  }

  const tasks: Task[] = [];
  for (let k = 0; k < 28; k++) {
    const off = Math.floor(rand() * DAYS * 0.9) + 3; // spread over the past year
    tasks.push({
      id: `demo-t${k + 1}`,
      dateKey: addDays(today, -off),
      title: TASK_TITLES[k % TASK_TITLES.length],
      type: "binary",
      target: 1,
      value: rand() < 0.85 ? 1 : 0,
      done: rand() < 0.85,
    });
  }
  // چند کار برای امروز (یکی با یادآور تا نوتیف قابل تست باشد)
  tasks.push(
    { id: "demo-t-today1", dateKey: today, title: "خرید نان", type: "binary", target: 1, value: 0, done: false },
    { id: "demo-t-today2", dateKey: today, title: "تماس با مامان", type: "binary", target: 1, value: 0, done: false, reminderAt: new Date(now + 60 * 60 * 1000).toISOString().slice(0, 16) },
    { id: "demo-t-today3", dateKey: today, title: "۳۰ دقیقه تمیزکاری", type: "quantity", target: 30, value: 10, done: false, unitKind: "time" },
  );

  const timerSessions: TimerSession[] = [];
  for (let k = 0; k < 120; k++) {
    const off = Math.floor(rand() * DAYS);
    const startHour = 8 + Math.floor(rand() * 13);
    const startedAt = now - off * dayMs - (24 - startHour) * 60 * 60 * 1000;
    const focus = (10 + Math.floor(rand() * 50)) * 60; // 10..60 min
    const habitIdx = rand() < 0.6 ? (rand() < 0.5 ? 1 : 0) : null; // مطالعه یا ورزش
    timerSessions.push({
      id: `demo-s${k + 1}`,
      mode: rand() < 0.6 ? "pomodoro" : rand() < 0.5 ? "free" : "stopwatch",
      focusSeconds: focus,
      startedAt,
      endedAt: startedAt + focus * 1000,
      ...(habitIdx !== null
        ? { linkedKind: "habit" as const, linkedId: `demo-h${habitIdx + 1}`, linkedLabel: SPECS[habitIdx].name }
        : {}),
    });
  }
  timerSessions.sort((a, b) => b.endedAt - a.endedAt);

  const journal: Record<string, JournalEntry> = {};
  for (let off = DAYS; off >= 0; off--) {
    if (rand() < 0.45) continue; // می‌نویسد حدوداً یک روز در میان
    const dk = addDays(today, -off);
    journal[dk] = {
      dateKey: dk,
      text: JOURNAL_LINES[Math.floor(rand() * JOURNAL_LINES.length)],
      score: 4 + Math.floor(rand() * 7), // 4..10
      mood: rand() < 0.8 ? MOOD_EMOJIS[Math.floor(rand() * MOOD_EMOJIS.length)] : null,
      updatedAt: now - off * dayMs,
    };
  }

  return { habits, logs, tasks, timerSessions, journal };
}

/** Replaces the db's content with the demo dataset (account/settings untouched). */
export function applyDemoContent(db: Db, now = Date.now()): Db {
  const demo = buildDemoContent(now);
  return { ...db, ...demo, notifications: [], meta: { ...db.meta, celebrated: [], firedReminders: [] } };
}
