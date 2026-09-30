import { dateKey } from "./dates";
import { isCompleted } from "./logic";
import {
  uid,
  type CustomGoalItem,
  type Db,
  type Goal,
  type GoalItem,
  type GoalItemMeasure,
  type Habit,
  type SourceGoalItem,
  type Task,
} from "./store";

export interface GoalItemProgress {
  value: number;
  target: number;
  percent: number;
  complete: boolean;
  sourceMissing: boolean;
  needsRelink: boolean;
}

export interface GoalProgress {
  value: number;
  target: number;
  percent: number;
  complete: boolean;
  items: GoalItemProgress[];
}

export type GoalDeadlineState =
  | { kind: "none"; days: 0 }
  | { kind: "remaining" | "overdue" | "completed-late"; days: number }
  | { kind: "completed-on-time"; days: 0 };

const DAY_MS = 24 * 60 * 60 * 1000;

export function goalDeadlineState(goal: Goal, now = Date.now()): GoalDeadlineState {
  if (!goal.deadlineAt) return { kind: "none", days: 0 };
  const deadline = new Date(goal.deadlineAt).getTime();
  if (!Number.isFinite(deadline)) return { kind: "none", days: 0 };
  if (goal.status === "completed" && goal.completedAt) {
    if (goal.completedAt <= deadline) return { kind: "completed-on-time", days: 0 };
    return { kind: "completed-late", days: Math.max(1, Math.ceil((goal.completedAt - deadline) / DAY_MS)) };
  }
  if (now <= deadline) {
    return { kind: "remaining", days: Math.max(0, Math.ceil((deadline - now) / DAY_MS)) };
  }
  return { kind: "overdue", days: Math.max(1, Math.ceil((now - deadline) / DAY_MS)) };
}

export function goalOverview(db: Db, now = Date.now()) {
  const total = db.goals.length;
  const completed = db.goals.filter((goal) => goal.status === "completed").length;
  const active = total - completed;
  const overdue = db.goals.filter((goal) => goalDeadlineState(goal, now).kind === "overdue").length;
  const percent = total
    ? Math.round(db.goals.reduce((sum, goal) => sum + goalProgress(db, goal).percent, 0) / total)
    : 0;
  return { percent, active, completed, overdue, total };
}

export function highestCrossedGoalMilestone(
  before: number,
  after: number,
  seen: readonly number[],
): 50 | 75 | 100 | null {
  for (const milestone of [100, 75, 50] as const) {
    if (before < milestone && after >= milestone && !seen.includes(milestone)) return milestone;
  }
  return null;
}

export function completeFullyProgressedGoals(db: Db, completedAt = Date.now()): Db {
  let changed = false;
  const goals = db.goals.map((goal) => {
    if (goal.status !== "active" || !goal.items.length || !goalProgress(db, goal).complete) return goal;
    changed = true;
    return { ...goal, status: "completed" as const, completedAt };
  });
  return changed ? { ...db, goals } : db;
}

/** A manual completion at partial progress is not the same as reaching 100%. */
export function reopenRegressedGoals(before: Db, after: Db): Db {
  if (before === after) return after;
  let changed = false;
  const goals = after.goals.map((goal) => {
    if (goal.status !== "completed" || !goal.items.length) return goal;
    const previous = before.goals.find((candidate) => candidate.id === goal.id);
    if (
      !previous || previous.status !== "completed" || !previous.items.length ||
      !previous.items.every((item) => goalItemProgress(before, item).complete) ||
      goal.items.every((item) => goalItemProgress(after, item).complete)
    ) return goal;
    changed = true;
    return { ...goal, status: "active" as const, completedAt: null };
  });
  return changed ? { ...after, goals } : after;
}

export const MAX_GOAL_TIME_TARGET_MINUTES = 9999 * 60 + 59;

function measureOf(source: Habit | Task): GoalItemMeasure {
  if (source.type === "binary") return "binary";
  return source.unitKind === "time" ? "time" : "count";
}

function progress(
  value: number,
  target: number,
): Pick<GoalItemProgress, "value" | "target" | "percent" | "complete"> {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 1;
  const complete = safeValue >= safeTarget;
  const percent = complete ? 100 : Math.min(99, Math.round((safeValue / safeTarget) * 100));
  return { value: safeValue, target: safeTarget, percent, complete };
}

function sourceFor(
  db: Db,
  sourceType: SourceGoalItem["sourceType"],
  sourceId: string,
): Habit | Task | undefined {
  return sourceType === "habit"
    ? db.habits.find((habit) => habit.id === sourceId)
    : db.tasks.find((task) => task.id === sourceId);
}

function valueAtLink(
  db: Db,
  source: Habit | Task,
  sourceType: SourceGoalItem["sourceType"],
  linkedDateKey: string,
): number {
  if (sourceType === "task") {
    const task = source as Task;
    return task.type === "binary" ? (task.done ? 1 : 0) : Math.max(0, task.value);
  }
  const habit = source as Habit;
  const log = db.logs[`${habit.id}|${linkedDateKey}`];
  if (habit.type === "binary") return isCompleted(habit, log) ? 1 : 0;
  return Math.max(0, log?.value ?? 0);
}

/** Builds a relation whose baseline excludes progress recorded before linking. */
export function createGoalItem(
  db: Db,
  sourceType: SourceGoalItem["sourceType"],
  sourceId: string,
  target: number,
  linkedAt = Date.now(),
): SourceGoalItem {
  const source = sourceFor(db, sourceType, sourceId);
  if (!source) throw new Error("goal-source-not-found");
  const measure = measureOf(source);
  const resolvedTarget = sourceType === "task" && measure === "binary" ? 1 : target;
  if (!Number.isFinite(resolvedTarget) || resolvedTarget <= 0)
    throw new Error("goal-target-invalid");
  const linkedDateKey = dateKey(new Date(linkedAt));
  return {
    id: uid(),
    kind: "source",
    sourceType,
    sourceId,
    sourceTitleSnapshot: sourceType === "habit" ? (source as Habit).name : (source as Task).title,
    measure,
    target: resolvedTarget,
    ...(sourceType === "habit" && (source as Habit).unit ? { unit: (source as Habit).unit } : {}),
    linkedAt,
    linkedDateKey,
    baselineValue: valueAtLink(db, source, sourceType, linkedDateKey),
  };
}

export type NewCustomGoalItem =
  | { title: string; measure: "binary" }
  | { title: string; measure: "count"; target: number; unit?: string }
  | { title: string; measure: "time"; targetMinutes: number };

export function createCustomGoalItem(input: NewCustomGoalItem): CustomGoalItem {
  const title = input.title.trim();
  if (!title) throw new Error("goal-item-title-required");
  if (input.measure === "binary") {
    return { id: uid(), kind: "custom", title, measure: "binary", value: false };
  }
  if (input.measure === "count") {
    if (!Number.isFinite(input.target) || input.target <= 0) throw new Error("goal-target-invalid");
    return {
      id: uid(),
      kind: "custom",
      title,
      measure: "count",
      value: 0,
      target: input.target,
      ...(input.unit ? { unit: input.unit } : {}),
    };
  }
  if (!Number.isFinite(input.targetMinutes) || input.targetMinutes <= 0)
    throw new Error("goal-target-invalid");
  if (input.targetMinutes > MAX_GOAL_TIME_TARGET_MINUTES)
    throw new Error("goal-time-target-too-large");
  return {
    id: uid(),
    kind: "custom",
    title,
    measure: "time",
    valueMinutes: 0,
    targetMinutes: input.targetMinutes,
  };
}

export function reconfigureCustomGoalItem(
  item: CustomGoalItem,
  input: NewCustomGoalItem,
): CustomGoalItem {
  const configured = createCustomGoalItem(input);
  const metadata = {
    ...(item.note ? { note: item.note } : {}),
    ...(item.mood ? { mood: item.mood } : {}),
  };
  if (configured.measure !== item.measure) return { ...configured, ...metadata, id: item.id };
  if (item.measure === "binary" && configured.measure === "binary") {
    return { ...configured, ...metadata, id: item.id, value: item.value };
  }
  if (item.measure === "count" && configured.measure === "count") {
    return { ...configured, ...metadata, id: item.id, value: item.value };
  }
  if (item.measure === "time" && configured.measure === "time") {
    return { ...configured, ...metadata, id: item.id, valueMinutes: item.valueMinutes };
  }
  return { ...configured, ...metadata, id: item.id };
}

export function completeCustomGoalItem(item: CustomGoalItem, completed: boolean): CustomGoalItem {
  if (item.measure === "binary") return { ...item, value: completed };
  if (item.measure === "count") return { ...item, value: completed ? item.target : 0 };
  return { ...item, valueMinutes: completed ? item.targetMinutes : 0 };
}

export type CustomGoalItemUpdate =
  | { value: boolean; title?: string }
  | { value: number; target?: number; unit?: string; title?: string }
  | { valueMinutes: number; targetMinutes?: number; title?: string };

export function updateCustomGoalItem(
  item: CustomGoalItem,
  update: CustomGoalItemUpdate,
): CustomGoalItem {
  const title = update.title?.trim() || item.title;
  if (item.measure === "binary") {
    if (!("value" in update) || typeof update.value !== "boolean")
      throw new Error("goal-item-update-invalid");
    return { ...item, title, value: update.value };
  }
  if (item.measure === "count") {
    if (!("value" in update) || typeof update.value !== "number")
      throw new Error("goal-item-update-invalid");
    if (!Number.isFinite(update.value)) return item;
    const target = "target" in update && update.target !== undefined ? update.target : item.target;
    if (!Number.isFinite(target) || target <= 0) throw new Error("goal-target-invalid");
    return {
      ...item,
      title,
      value: Math.max(0, update.value),
      target,
      ...("unit" in update ? { unit: update.unit } : {}),
    };
  }
  if (!("valueMinutes" in update) || typeof update.valueMinutes !== "number")
    throw new Error("goal-item-update-invalid");
  if (!Number.isFinite(update.valueMinutes)) return item;
  const targetMinutes = update.targetMinutes ?? item.targetMinutes;
  if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) throw new Error("goal-target-invalid");
  return {
    ...item,
    title,
    valueMinutes: Math.max(0, update.valueMinutes),
    targetMinutes,
  };
}

function missingProgress(
  item: SourceGoalItem,
  key: "sourceMissing" | "needsRelink",
): GoalItemProgress {
  return {
    ...progress(0, item.target),
    sourceMissing: key === "sourceMissing",
    needsRelink: key === "needsRelink",
  };
}

export function goalItemProgress(db: Db, item: GoalItem): GoalItemProgress {
  if (item.kind === "custom") {
    const derived =
      item.measure === "binary"
        ? progress(item.value ? 1 : 0, 1)
        : item.measure === "count"
          ? progress(item.value, item.target)
          : progress(item.valueMinutes, item.targetMinutes);
    return { ...derived, sourceMissing: false, needsRelink: false };
  }

  const source = sourceFor(db, item.sourceType, item.sourceId);
  if (!source) return missingProgress(item, "sourceMissing");
  if (measureOf(source) !== item.measure) return missingProgress(item, "needsRelink");

  let value = 0;
  if (item.sourceType === "task") {
    const task = source as Task;
    value = item.measure === "binary" ? (task.done ? 1 : 0) : task.value - item.baselineValue;
  } else {
    const habit = source as Habit;
    for (const log of Object.values(db.logs)) {
      if (log.habitId !== habit.id || log.dateKey < item.linkedDateKey) continue;
      const logValue =
        item.measure === "binary" ? (isCompleted(habit, log) ? 1 : 0) : Math.max(0, log.value);
      value +=
        log.dateKey === item.linkedDateKey ? Math.max(0, logValue - item.baselineValue) : logValue;
    }
  }

  return {
    ...progress(value, item.target),
    sourceMissing: false,
    needsRelink: false,
  };
}

export function goalProgress(db: Db, goal: Goal): GoalProgress {
  if (goal.items.length === 0) {
    const complete = goal.status === "completed";
    return {
      value: complete ? 100 : 0,
      target: 100,
      percent: complete ? 100 : 0,
      complete,
      items: [],
    };
  }
  const items = goal.items.map((item) => goalItemProgress(db, item));
  if (goal.status === "completed") {
    return { value: 100, target: 100, percent: 100, complete: true, items };
  }
  const complete = items.length > 0 && items.every((item) => item.complete);
  const roundedPercent = items.length
    ? Math.round(items.reduce((sum, item) => sum + item.percent, 0) / items.length)
    : 0;
  const percent = complete ? 100 : Math.min(99, roundedPercent);
  return {
    value: percent,
    target: 100,
    percent,
    complete,
    items,
  };
}

export function goalHasSource(
  goal: Goal,
  sourceType: SourceGoalItem["sourceType"],
  sourceId: string,
): boolean {
  return goal.items.some(
    (item) =>
      item.kind === "source" && item.sourceType === sourceType && item.sourceId === sourceId,
  );
}

export function addGoalItem(goal: Goal, item: GoalItem): Goal {
  if (goal.items.length >= 50) return goal;
  if (item.kind === "source" && goalHasSource(goal, item.sourceType, item.sourceId)) return goal;
  return {
    ...goal,
    ...(goal.items.length === 0 ? { status: "active" as const, completedAt: null } : {}),
    items: [...goal.items, item],
  };
}

export function linkedGoalsForSource(
  db: Db,
  sourceType: SourceGoalItem["sourceType"],
  sourceId: string,
): Goal[] {
  return db.goals.filter((goal) => goalHasSource(goal, sourceType, sourceId));
}
