import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./presets";
import { buildDemoContent } from "./seed-demo";
import { defaultDb, logKey, type Db } from "./store";
import { loginAs, wipeContent } from "./wipe";

function seededDb(): Db {
  const db = defaultDb(DEFAULT_CATEGORIES);
  return {
    ...db,
    auth: { phone: "989111111111", verifiedAt: 1000 },
    subscription: { planId: "p3", startedAt: 1, expiresAt: 9_999_999_999_999 },
    settings: { ...db.settings, onboarded: true, theme: "dark", lang: "fa" },
    habits: [
      {
        id: "h1",
        name: "ورزش",
        categoryId: "sport",
        type: "binary",
        target: 1,
        schedule: { kind: "daily" },
        monthlyGoal: null,
        reminderTime: "08:00",
        createdAt: 1000,
      },
    ],
    logs: {
      [logKey("h1", "2026-07-01")]: { habitId: "h1", dateKey: "2026-07-01", value: 1, done: true },
    },
    tasks: [
      {
        id: "t1",
        dateKey: "2026-07-01",
        title: "کار",
        type: "binary",
        target: 1,
        value: 1,
        done: true,
      },
    ],
    journal: {
      "2026-07-01": { dateKey: "2026-07-01", text: "روز خوب", score: 8, mood: null, updatedAt: 1 },
    },
    meta: { ...db.meta, dataOwner: "989111111111", celebrated: ["x"], firedReminders: ["y"] },
  };
}

describe("wipeContent", () => {
  it("erases user content and reseeds default categories", () => {
    const next = wipeContent(seededDb());
    expect(next.habits).toEqual([]);
    expect(next.logs).toEqual({});
    expect(next.tasks).toEqual([]);
    expect(next.journal).toEqual({});
    expect(next.timerSessions).toEqual([]);
    expect(next.notifications).toEqual([]);
    expect(next.meta.celebrated).toEqual([]);
    expect(next.meta.firedReminders).toEqual([]);
    expect(next.categories).toHaveLength(DEFAULT_CATEGORIES.length);
  });

  it("keeps the account, subscription, and settings", () => {
    const next = wipeContent(seededDb());
    expect(next.auth?.phone).toBe("989111111111");
    expect(next.subscription?.planId).toBe("p3");
    expect(next.settings.onboarded).toBe(true);
    expect(next.settings.theme).toBe("dark");
    expect(next.meta.dataOwner).toBe("989111111111");
  });
});

describe("loginAs — account isolation", () => {
  it("same phone signing back in keeps everything", () => {
    const signedOut: Db = { ...seededDb(), auth: null };
    const next = loginAs(signedOut, "989111111111", undefined, 5000);
    expect(next.habits).toHaveLength(1);
    expect(next.subscription?.planId).toBe("p3");
    expect(next.auth).toEqual({ phone: "989111111111", verifiedAt: 5000 });
    expect(next.meta.dataOwner).toBe("989111111111");
  });

  it("never deletes current-vault content while applying a different account identity", () => {
    const signedOut: Db = { ...seededDb(), auth: null };
    const next = loginAs(signedOut, "989222222222", undefined, 5000);
    expect(next.habits).toHaveLength(1);
    expect(next.logs).toEqual(signedOut.logs);
    expect(next.journal).toEqual(signedOut.journal);
    expect(next.subscription?.planId).toBe("p3");
    expect(next.auth?.phone).toBe("989222222222");
    expect(next.meta.dataOwner).toBe("989222222222");
    expect(next.settings.onboarded).toBe(true); // device stays onboarded
  });

  it("a different phone WITH its own server subscription gets that one", () => {
    const signedOut: Db = { ...seededDb(), auth: null };
    const sub = { planId: "p1", startedAt: 5000, expiresAt: 6000 };
    const next = loginAs(signedOut, "989222222222", sub, 5000);
    expect(next.subscription).toEqual(sub);
    expect(next.habits).toHaveLength(1);
  });

  it("first login ever adopts existing data (migration path)", () => {
    const preAccount: Db = {
      ...seededDb(),
      auth: null,
      subscription: null,
      meta: { ...seededDb().meta, dataOwner: null },
    };
    const next = loginAs(preAccount, "989333333333");
    expect(next.habits).toHaveLength(1); // nothing wiped
    expect(next.meta.dataOwner).toBe("989333333333");
  });

  it("an explicit empty server answer clears the cached subscription", () => {
    const sameOwner = loginAs({ ...seededDb(), auth: null }, "989111111111", null);
    expect(sameOwner.subscription).toBeNull();
    const switched = loginAs({ ...seededDb(), auth: null }, "989222222222", null);
    expect(switched.subscription).toBeNull();
  });

  it("preserves the cached subscription only when the argument is omitted", () => {
    const next = loginAs({ ...seededDb(), auth: null }, "989111111111");
    expect(next.subscription?.planId).toBe("p3");
  });
});

describe("buildDemoContent", () => {
  const demo = buildDemoContent(new Date(2026, 6, 19, 12).getTime());

  it("is deterministic", () => {
    const again = buildDemoContent(new Date(2026, 6, 19, 12).getTime());
    expect(again).toEqual(demo);
  });

  it("covers a full year with realistic volume", () => {
    expect(demo.habits.length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(demo.logs).length).toBeGreaterThan(1000);
    expect(Object.keys(demo.journal).length).toBeGreaterThan(120);
    expect(demo.timerSessions.length).toBe(120);
    expect(demo.tasks.length).toBeGreaterThan(25);
    // oldest habit really is ~a year old
    const oldest = Math.min(...demo.habits.map((h) => h.createdAt));
    expect(Date.now() - oldest).toBeGreaterThan(360 * 24 * 60 * 60 * 1000 - 1);
  });

  it("every log belongs to an existing habit, is keyed correctly, and is on/after its habit's createdAt", () => {
    const byId = new Map(demo.habits.map((h) => [h.id, h]));
    for (const [key, log] of Object.entries(demo.logs)) {
      expect(key).toBe(logKey(log.habitId, log.dateKey));
      const habit = byId.get(log.habitId);
      expect(habit).toBeDefined();
      expect(new Date(log.dateKey + "T23:59:59").getTime()).toBeGreaterThanOrEqual(
        habit!.createdAt - 24 * 60 * 60 * 1000,
      );
    }
  });

  it("keeps at least one reminder so notifications are testable", () => {
    expect(demo.habits.some((h) => h.reminderTime)).toBe(true);
    expect(demo.tasks.some((t) => t.reminderAt)).toBe(true);
  });
});
