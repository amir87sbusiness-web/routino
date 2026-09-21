import { addDays, faNum, keyToDate, monthDays, todayKey, type Calendar, type Lang } from "./dates";
import { getLog, isCompleted, isDueOn } from "./logic";
import type { Db, Habit, Task } from "./store";

export interface HabitLifetimeStats {
  longestStreak: number;
  totalValue: number;
}

export function habitLifetimeStats(
  db: Db,
  habit: Habit,
  cal: Calendar,
  today = todayKey(),
): HabitLifetimeStats {
  const created = new Date(habit.createdAt);
  created.setHours(0, 0, 0, 0);
  const createdKey = [
    created.getFullYear(),
    String(created.getMonth() + 1).padStart(2, "0"),
    String(created.getDate()).padStart(2, "0"),
  ].join("-");
  const relevantLogs = Object.values(db.logs).filter(
    (log) => log.habitId === habit.id && log.dateKey <= today,
  );
  if (relevantLogs.length === 0) return { longestStreak: 0, totalValue: 0 };

  const firstLogKey = relevantLogs.reduce(
    (earliest, log) => (log.dateKey < earliest ? log.dateKey : earliest),
    relevantLogs[0].dateKey,
  );
  let dateKey = firstLogKey > createdKey ? firstLogKey : createdKey;
  let currentStreak = 0;
  let longestStreak = 0;

  while (dateKey <= today) {
    if (isDueOn(habit, dateKey, cal)) {
      if (isCompleted(habit, getLog(db, habit.id, dateKey))) {
        currentStreak += 1;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    dateKey = addDays(dateKey, 1);
  }

  const totalValue = relevantLogs.reduce((sum, log) => sum + Math.max(0, log.value), 0);

  return { longestStreak, totalValue };
}

export function formatCompactValue(value: number, lang: Lang): string {
  if (Math.abs(value) < 1_000) return faNum(Number(value.toFixed(1)), lang);
  const compact = Number((value / 1_000).toFixed(1));
  return `${faNum(compact, lang)}K`;
}

export type TaskAnalyticsStatus = "done" | "pending" | "overdue";
type TaskWithDeadline = Task & { deadlineAt?: string | null };

export interface TaskMonthAnalytics {
  series: { dateKey: string; percent: number | null }[];
  items: { task: Task; status: TaskAnalyticsStatus }[];
}

export function taskMonthAnalytics(
  tasks: Task[],
  monthAnchor: string,
  cal: Calendar,
  options: { today?: string; now?: Date } = {},
): TaskMonthAnalytics {
  const today = options.today ?? todayKey();
  const now = options.now ?? new Date();
  const days = monthDays(monthAnchor, cal);
  const daySet = new Set(days);
  const monthTasks = tasks.filter((task) => daySet.has(task.dateKey));
  const series = days.map((dateKey) => {
    if (dateKey > today) return { dateKey, percent: null };
    const tasksForDay = monthTasks.filter((task) => task.dateKey === dateKey);
    if (tasksForDay.length === 0) return { dateKey, percent: null };
    const done = tasksForDay.filter((task) => task.done).length;
    return { dateKey, percent: Math.round((done / tasksForDay.length) * 100) };
  });
  const items = monthTasks.map((task) => {
    const deadlineAt = (task as TaskWithDeadline).deadlineAt;
    const status: TaskAnalyticsStatus = task.done
      ? "done"
      : deadlineAt && keyToDateTime(deadlineAt) < now.getTime()
        ? "overdue"
        : "pending";
    return { task, status };
  });

  return { series, items };
}

function keyToDateTime(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
