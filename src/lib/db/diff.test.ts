import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../presets";
import { defaultDb, logKey, type Db, type Habit } from "../store";
import { diffDb, type Change } from "./diff";

function habit(id: string, name = id): Habit {
  return {
    id,
    name,
    categoryId: "study",
    type: "binary",
    target: 1,
    schedule: { kind: "daily" },
    monthlyGoal: null,
    reminderTime: null,
    createdAt: 1000,
  };
}

/** A db with one habit and a month of logs for it. */
function seed(): Db {
  const base = defaultDb(DEFAULT_CATEGORIES);
  const logs: Db["logs"] = {};
  for (let d = 1; d <= 30; d++) {
    const dk = `2026-07-${String(d).padStart(2, "0")}`;
    logs[logKey("h1", dk)] = { habitId: "h1", dateKey: dk, value: 1, done: true };
  }
  return { ...base, habits: [habit("h1"), habit("h2")], logs };
}

const find = (cs: Change[], table: string, key: string) =>
  cs.find((c) => c.table === table && c.key === key);
const forTable = (cs: Change[], table: string) => cs.filter((c) => c.table === table);

describe("diffDb", () => {
  it("emits nothing when nothing changed", () => {
    const db = seed();
    expect(diffDb(db, db)).toEqual([]);
  });

  it("emits nothing for a new object graph with identical record references", () => {
    // This is the property the whole design rests on: React replaces the
    // container but keeps element references, so untouched records cost nothing.
    const db = seed();
    const next: Db = { ...db, habits: [...db.habits], logs: { ...db.logs } };
    expect(diffDb(db, next)).toEqual([]);
  });

  it("emits one change for a single-field edit", () => {
    const db = seed();
    const next: Db = {
      ...db,
      habits: db.habits.map((h) => (h.id === "h1" ? { ...h, name: "renamed" } : h)),
    };
    const changes = diffDb(db, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ table: "habits", key: "h1", deleted: false });
    expect((changes[0].data as Habit).name).toBe("renamed");
  });

  it("emits a tombstone for a delete", () => {
    const db = seed();
    const next: Db = { ...db, habits: db.habits.filter((h) => h.id !== "h2") };
    const changes = diffDb(db, next);
    expect(changes).toEqual([{ table: "habits", key: "h2", deleted: true }]);
  });

  it("does not emit 30 log tombstones when a habit with logs is deleted", () => {
    // The habit delete cascades server-side by habitId. Pushing one tombstone per
    // child log would turn a single tap into a 700-row push at real data volumes.
    const db = seed();
    const next: Db = { ...db, habits: db.habits.filter((h) => h.id !== "h1") };
    const changes = diffDb(db, next);
    expect(changes).toEqual([{ table: "habits", key: "h1", deleted: true }]);
    expect(forTable(changes, "logs")).toHaveLength(0);
  });

  it("diffs keyed collections by key", () => {
    const db = seed();
    const k = logKey("h1", "2026-07-01");
    const next: Db = { ...db, logs: { ...db.logs, [k]: { ...db.logs[k], value: 5 } } };
    const changes = diffDb(db, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ table: "logs", key: k, deleted: false });
  });

  it("emits an added journal entry and a tombstone for a removed one", () => {
    const db: Db = {
      ...seed(),
      journal: {
        "2026-07-01": { dateKey: "2026-07-01", text: "a", score: null, mood: null, updatedAt: 1 },
      },
    };
    const added: Db = {
      ...db,
      journal: {
        ...db.journal,
        "2026-07-02": { dateKey: "2026-07-02", text: "b", score: null, mood: null, updatedAt: 2 },
      },
    };
    expect(diffDb(db, added)).toEqual([
      { table: "journal", key: "2026-07-02", data: added.journal["2026-07-02"], deleted: false },
    ]);

    const removed: Db = { ...db, journal: {} };
    expect(diffDb(db, removed)).toEqual([{ table: "journal", key: "2026-07-01", deleted: true }]);
  });

  describe("settings", () => {
    it("emits one row per changed field, not the whole object", () => {
      const db = seed();
      const next: Db = { ...db, settings: { ...db.settings, lang: "en" } };
      const changes = diffDb(db, next);
      expect(changes).toEqual([
        { table: "settings", key: "lang", data: { value: "en" }, deleted: false },
      ]);
    });

    it("ignores device-local fields", () => {
      // Device preferences must never follow an account onto another device.
      const db = seed();
      const next: Db = {
        ...db,
        settings: {
          ...db.settings,
          theme: "dark",
          notificationsEnabled: false,
          completionSoundEnabled: false,
          hapticsEnabled: false,
        },
      };
      expect(diffDb(db, next)).toEqual([]);
    });

    it("syncs onboarded so a second device skips onboarding", () => {
      const db = seed();
      const next: Db = { ...db, settings: { ...db.settings, onboarded: true } };
      expect(diffDb(db, next)).toEqual([
        { table: "settings", key: "onboarded", data: { value: true }, deleted: false },
      ]);
    });

    it("emits journalReminder when cleared to null", () => {
      const db = seed();
      const next: Db = { ...db, settings: { ...db.settings, journalReminder: null } };
      expect(diffDb(db, next)).toEqual([
        { table: "settings", key: "journalReminder", data: { value: null }, deleted: false },
      ]);
    });
  });

  it("emits every record on first persist (prev = null)", () => {
    const db = seed();
    const changes = diffDb(null, db);
    expect(forTable(changes, "habits")).toHaveLength(2);
    expect(forTable(changes, "logs")).toHaveLength(30);
    expect(forTable(changes, "categories")).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(forTable(changes, "settings")).toHaveLength(5); // synced fields only
    expect(changes.every((c) => !c.deleted)).toBe(true);
  });

  it("ignores device-local collections entirely", () => {
    const db = seed();
    const next: Db = {
      ...db,
      auth: { phone: "989123334444", verifiedAt: 1 },
      notifications: [{ id: "n1", title: "t", body: "b", at: 1, read: false }],
      meta: {
        ...db.meta,
        sessions: db.meta.sessions + 1,
        firedReminders: ["x"],
        celebrated: ["y"],
      },
    };
    expect(diffDb(db, next)).toEqual([]);
  });

  it("handles simultaneous add, edit and delete in one update", () => {
    const db = seed();
    const next: Db = {
      ...db,
      habits: [{ ...db.habits[0], name: "edited" }, habit("h3")],
    };
    const changes = diffDb(db, next);
    expect(find(changes, "habits", "h1")).toMatchObject({ deleted: false });
    expect(find(changes, "habits", "h3")).toMatchObject({ deleted: false });
    expect(find(changes, "habits", "h2")).toEqual({ table: "habits", key: "h2", deleted: true });
    expect(changes).toHaveLength(3);
  });
});
