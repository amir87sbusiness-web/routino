import { dateKey } from "./dates";
import type { Habit, Task } from "./store";

const LOCAL_DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function localDateTimeMs(value: string): number | null {
  if (!LOCAL_DATE_TIME_RE.test(value)) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function isHabitDeadlinePassed(habit: Habit, dayKey: string, now = new Date()): boolean {
  if (!habit.deadlineTime || !TIME_RE.test(habit.deadlineTime)) return false;
  const deadline = localDateTimeMs(`${dayKey}T${habit.deadlineTime}`);
  return deadline !== null && now.getTime() >= deadline;
}

export function isTaskOverdue(task: Task, now = new Date()): boolean {
  if (task.done || !task.deadlineAt) return false;
  const deadline = localDateTimeMs(task.deadlineAt);
  return deadline !== null && now.getTime() >= deadline;
}

export function isTaskVisibleOn(task: Task, dayKey: string, now = new Date()): boolean {
  if (!task.deadlineAt) return task.dateKey === dayKey;
  if (task.done) return task.dateKey === dayKey;
  if (dayKey < task.dateKey) return false;
  const deadlineDay = task.deadlineAt.slice(0, 10);
  if (dayKey <= deadlineDay) return true;
  return !task.done && dayKey === dateKey(now);
}

export function tasksVisibleOn(tasks: Task[], dayKey: string, now = new Date()): Task[] {
  return tasks.filter((task) => isTaskVisibleOn(task, dayKey, now));
}
