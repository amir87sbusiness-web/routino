import { addDays, dateKey } from "./dates";
import { dueHabitsOn, getLog, isCompleted } from "./logic";
import type { Db } from "./store";

const DAY_MS = 86_400_000;
const PAID_LOOKBACK_MS = 30 * DAY_MS;

export interface SubscriptionProgress {
  kind: "trial" | "paid";
  startAt: number;
  endAt: number;
  completedCheckIns: number;
  activeDays: number;
  opportunities: number;
  completionRate: number | null;
  bestHabit: {
    id: string;
    name: string;
    completed: number;
    opportunities: number;
  } | null;
}

/** Real, local-first progress for the entitlement period shown on the paywall. */
export function subscriptionProgress(db: Db, now = Date.now()): SubscriptionProgress | null {
  const subscription = db.subscription;
  if (!subscription) return null;

  const kind = subscription.trial ? "trial" : "paid";
  const endAt = subscription.expiresAt;
  const startAt = subscription.trial ? endAt - 7 * DAY_MS : endAt - PAID_LOOKBACK_MS;
  const lastVisibleAt = Math.min(now, endAt - 1);
  const perHabit = new Map<
    string,
    { id: string; name: string; completed: number; opportunities: number }
  >();
  let completedCheckIns = 0;
  let opportunities = 0;
  let activeDays = 0;

  if (lastVisibleAt >= startAt) {
    const firstKey = dateKey(new Date(startAt));
    const lastKey = dateKey(new Date(lastVisibleAt));
    for (let key = firstKey; key <= lastKey; key = addDays(key, 1)) {
      let completedToday = false;
      for (const habit of dueHabitsOn(db, key, db.settings.calendar)) {
        const progress = perHabit.get(habit.id) ?? {
          id: habit.id,
          name: habit.name,
          completed: 0,
          opportunities: 0,
        };
        progress.opportunities += 1;
        opportunities += 1;
        if (isCompleted(habit, getLog(db, habit.id, key))) {
          progress.completed += 1;
          completedCheckIns += 1;
          completedToday = true;
        }
        perHabit.set(habit.id, progress);
      }
      if (completedToday) activeDays += 1;
    }
  }

  const bestHabit =
    [...perHabit.values()]
      .filter((habit) => habit.completed >= 2)
      .sort(
        (a, b) =>
          b.completed / b.opportunities - a.completed / a.opportunities ||
          b.completed - a.completed ||
          a.name.localeCompare(b.name),
      )[0] ?? null;

  return {
    kind,
    startAt,
    endAt,
    completedCheckIns,
    activeDays,
    opportunities,
    completionRate:
      opportunities > 0 ? Math.round((completedCheckIns / opportunities) * 100) : null,
    bestHabit,
  };
}
