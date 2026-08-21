import { describe, expect, it } from "vitest";
import { dateKey } from "./dates";
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb, logKey, type Habit } from "./store";
import { subscriptionProgress } from "./subscription-progress";

const NOW = new Date(2026, 7, 21, 12).getTime();
const EXPIRY = new Date(2026, 7, 22, 0).getTime();

function habit(id: string, name: string, createdAt: number): Habit {
  return {
    id,
    name,
    categoryId: "general",
    type: "binary",
    target: 1,
    schedule: { kind: "daily" },
    monthlyGoal: null,
    reminderTime: null,
    createdAt,
  };
}

describe("subscriptionProgress", () => {
  it("derives a trial window from expiresAt minus exactly seven days and reports real check-ins", () => {
    const db = defaultDb(DEFAULT_CATEGORIES);
    const startedAt = EXPIRY - 7 * 86_400_000;
    db.subscription = { planId: "trial", trial: true, startedAt: 1, expiresAt: EXPIRY };
    db.habits = [habit("walk", "Walk", startedAt), habit("read", "Read", startedAt)];
    for (const offset of [0, 1, 3]) {
      const dk = dateKey(new Date(startedAt + offset * 86_400_000));
      db.logs[logKey("walk", dk)] = { habitId: "walk", dateKey: dk, value: 1, done: true };
    }

    expect(subscriptionProgress(db, NOW)).toEqual({
      kind: "trial",
      startAt: startedAt,
      endAt: EXPIRY,
      completedCheckIns: 3,
      activeDays: 3,
      opportunities: 14,
      completionRate: 21,
      bestHabit: { id: "walk", name: "Walk", completed: 3, opportunities: 7 },
    });
  });

  it("uses paid framing for an expired paid plan and never invents progress", () => {
    const db = defaultDb(DEFAULT_CATEGORIES);
    db.subscription = {
      planId: "m3",
      trial: false,
      // Payment entitlements may reconstruct this cache field at fetch time;
      // recent paid progress must not become an empty future window.
      startedAt: NOW,
      expiresAt: NOW - 86_400_000,
    };

    expect(subscriptionProgress(db, NOW)).toMatchObject({
      kind: "paid",
      startAt: NOW - 31 * 86_400_000,
      completedCheckIns: 0,
      activeDays: 0,
      opportunities: 0,
      completionRate: null,
      bestHabit: null,
    });
  });
});
