import { describe, expect, it } from "vitest";
import { dateKey } from "./dates";
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb, logKey, type Habit } from "./store";
import { subscriptionProgress } from "./subscription-progress";

const DAY_MS = 86_400_000;
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
  it("uses the real three-day trial start and reports real check-ins", () => {
    const db = defaultDb(DEFAULT_CATEGORIES);
    const startedAt = EXPIRY - 3 * DAY_MS;
    db.subscription = { planId: "trial", trial: true, startedAt, expiresAt: EXPIRY };
    db.habits = [habit("walk", "Walk", startedAt), habit("read", "Read", startedAt)];
    for (const offset of [0, 1, 2]) {
      const dk = dateKey(new Date(startedAt + offset * DAY_MS));
      db.logs[logKey("walk", dk)] = { habitId: "walk", dateKey: dk, value: 1, done: true };
    }

    expect(subscriptionProgress(db, NOW)).toEqual({
      kind: "trial",
      startAt: startedAt,
      endAt: EXPIRY,
      completedCheckIns: 3,
      activeDays: 3,
      opportunities: 6,
      completionRate: 50,
      bestHabit: { id: "walk", name: "Walk", completed: 3, opportunities: 3 },
    });
  });

  it("keeps a legacy seven-day trial window when its stored start is seven days earlier", () => {
    const db = defaultDb(DEFAULT_CATEGORIES);
    const startedAt = EXPIRY - 7 * DAY_MS;
    db.subscription = { planId: "trial", trial: true, startedAt, expiresAt: EXPIRY };

    expect(subscriptionProgress(db, NOW)).toMatchObject({
      kind: "trial",
      startAt: startedAt,
      endAt: EXPIRY,
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
      expiresAt: NOW - DAY_MS,
    };

    expect(subscriptionProgress(db, NOW)).toMatchObject({
      kind: "paid",
      startAt: NOW - 31 * DAY_MS,
      completedCheckIns: 0,
      activeDays: 0,
      opportunities: 0,
      completionRate: null,
      bestHabit: null,
    });
  });
});
