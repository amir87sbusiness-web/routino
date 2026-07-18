/** Pure habit/analytics computations. */
import { addDays, dayOfMonth, keyToDate, monthDays, todayKey, type Calendar } from "./dates";
import { logKey, type Db, type Habit, type HabitLog } from "./store";

export function isDueOn(habit: Habit, dk: string, cal: Calendar): boolean {
  const created = new Date(habit.createdAt);
  created.setHours(0, 0, 0, 0);
  if (keyToDate(dk).getTime() < created.getTime()) return false;
  const s = habit.schedule;
  if (s.kind === "daily") return true;
  if (s.kind === "odd") return dayOfMonth(dk, cal) % 2 === 1;
  if (s.kind === "even") return dayOfMonth(dk, cal) % 2 === 0;
  if (s.kind === "weekdays") return (s.weekdays ?? []).includes(keyToDate(dk).getDay());
  return true;
}

export function getLog(db: Db, habitId: string, dk: string): HabitLog | undefined {
  return db.logs[logKey(habitId, dk)];
}

/** Raw percent (can exceed 100). */
export function rawPercent(habit: Habit, log: HabitLog | undefined): number {
  if (!log) return 0;
  if (habit.type === "binary") return log.done ? 100 : 0;
  if (habit.target <= 0) return log.done ? 100 : 0;
  return Math.round((log.value / habit.target) * 100);
}

/** Capped percent for analytics (max 100). */
export function cappedPercent(habit: Habit, log: HabitLog | undefined): number {
  return Math.min(100, rawPercent(habit, log));
}

export function isCompleted(habit: Habit, log: HabitLog | undefined): boolean {
  if (!log) return false;
  if (habit.type === "binary") return log.done;
  return log.done || log.value >= habit.target;
}

export function dueHabitsOn(db: Db, dk: string, cal: Calendar): Habit[] {
  return db.habits.filter((h) => !h.archived && isDueOn(h, dk, cal));
}

/** Average capped completion of all due habits on a day (0-100). */
export function dayScore(db: Db, dk: string, cal: Calendar): number | null {
  const due = dueHabitsOn(db, dk, cal);
  if (due.length === 0) return null;
  const sum = due.reduce((acc, h) => acc + cappedPercent(h, getLog(db, h.id, dk)), 0);
  return Math.round(sum / due.length);
}

/** Consecutive due-day completion streak ending today (or yesterday if today not yet done). */
export function streak(db: Db, habit: Habit, cal: Calendar): number {
  let dk = todayKey();
  let count = 0;
  // today counts only if completed; otherwise start from yesterday
  if (isDueOn(habit, dk, cal) && !isCompleted(habit, getLog(db, habit.id, dk))) {
    dk = addDays(dk, -1);
  }
  for (let i = 0; i < 730; i++) {
    if (keyToDate(dk).getTime() < new Date(habit.createdAt).setHours(0, 0, 0, 0)) break;
    if (isDueOn(habit, dk, cal)) {
      if (isCompleted(habit, getLog(db, habit.id, dk))) count++;
      else break;
    }
    dk = addDays(dk, -1);
  }
  return count;
}

export interface MonthProgress {
  doneDays: number;
  goalDays: number;
  percent: number; // 0-100
}

/** Progress toward the monthly goal within the current calendar month. */
export function monthProgress(db: Db, habit: Habit, cal: Calendar, refKey = todayKey()): MonthProgress {
  const days = monthDays(refKey, cal);
  const dueDays = days.filter((d) => isDueOn(habit, d, cal));
  const goalDays = habit.monthlyGoal ?? dueDays.length;
  const doneDays = dueDays.filter((d) => isCompleted(habit, getLog(db, habit.id, d))).length;
  const percent = goalDays > 0 ? Math.min(100, Math.round((doneDays / goalDays) * 100)) : 0;
  return { doneDays, goalDays: goalDays || dueDays.length, percent };
}

export interface EarnedBadge {
  /** Stable `${habitId}|${monthId}` key. */
  id: string;
  habitId: string;
  habitName: string;
  /** First day-key of the month the badge was earned in. */
  monthId: string;
}

/**
 * Every (habit, month) pair whose monthly goal was fully met, newest month
 * first. Derived from the logs rather than recorded when the goal is crossed,
 * so the badge list stays correct no matter how the data got there (editing an
 * old day, importing, un-completing and re-completing) and can never drift out
 * of sync with what the habit screen shows.
 */
export function earnedBadges(db: Db, cal: Calendar): EarnedBadge[] {
  const monthIds = new Set<string>([monthDays(todayKey(), cal)[0]]);
  for (const log of Object.values(db.logs)) {
    monthIds.add(monthDays(log.dateKey, cal)[0]);
  }
  const out: EarnedBadge[] = [];
  for (const habit of db.habits) {
    for (const monthId of monthIds) {
      if (monthProgress(db, habit, cal, monthId).percent >= 100) {
        out.push({ id: `${habit.id}|${monthId}`, habitId: habit.id, habitName: habit.name, monthId });
      }
    }
  }
  return out.sort((a, b) => (a.monthId < b.monthId ? 1 : -1));
}

/** Success rate over last N days: completed due days / due days. */
export function successRate(db: Db, habit: Habit, cal: Calendar, days: number): number {
  let dk = todayKey();
  let due = 0;
  let done = 0;
  for (let i = 0; i < days; i++) {
    if (isDueOn(habit, dk, cal)) {
      due++;
      if (isCompleted(habit, getLog(db, habit.id, dk))) done++;
    }
    dk = addDays(dk, -1);
  }
  return due === 0 ? 0 : Math.round((done / due) * 100);
}

/** Series of capped daily percents for the last N days (oldest first). */
export function habitSeries(db: Db, habit: Habit, cal: Calendar, days: number) {
  const out: { dateKey: string; percent: number | null }[] = [];
  let dk = addDays(todayKey(), -(days - 1));
  for (let i = 0; i < days; i++) {
    out.push({
      dateKey: dk,
      percent: isDueOn(habit, dk, cal) ? cappedPercent(habit, getLog(db, habit.id, dk)) : null,
    });
    dk = addDays(dk, 1);
  }
  return out;
}

/** Overall daily score series for last N days (oldest first). */
export function overallSeries(db: Db, cal: Calendar, days: number) {
  const out: { dateKey: string; percent: number | null }[] = [];
  let dk = addDays(todayKey(), -(days - 1));
  for (let i = 0; i < days; i++) {
    out.push({ dateKey: dk, percent: dayScore(db, dk, cal) });
    dk = addDays(dk, 1);
  }
  return out;
}

/** Average of non-null percents in a series. */
export function avgOf(series: { percent: number | null }[]): number {
  const vals = series.filter((s) => s.percent !== null).map((s) => s.percent as number);
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/** Compare this week vs previous week overall performance. */
export function weekComparison(db: Db, cal: Calendar) {
  const all = overallSeries(db, cal, 14);
  const prev = avgOf(all.slice(0, 7));
  const cur = avgOf(all.slice(7));
  return { prev, cur, delta: cur - prev };
}

export function subscriptionActive(db: Db, now = Date.now()): boolean {
  if (db.meta.tampered) return false;
  return !!db.subscription && db.subscription.expiresAt > now;
}
