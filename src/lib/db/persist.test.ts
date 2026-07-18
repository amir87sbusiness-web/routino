import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../presets";
import { defaultDb, type Db, type Habit, type TimerSession } from "../store";
import { db as idb } from "./dexie";
import { diffDb } from "./diff";
import { hydrate } from "./hydrate";
import { applyChanges, pendingChanges } from "./persist";

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

beforeEach(async () => {
  localStorage.clear();
  await Promise.all(idb.tables.map((t) => t.clear()));
});

/** Persist a Db the way AppProvider's effect does, and read it back. */
async function persistAndHydrate(prev: Db | null, next: Db): Promise<Db> {
  await applyChanges(diffDb(prev, next));
  return (await hydrate()).db;
}

describe("applyChanges", () => {
  it("round-trips a db through storage", async () => {
    const base = defaultDb(DEFAULT_CATEGORIES);
    const next: Db = { ...base, habits: [habit("h1", "مطالعه")] };
    const out = await persistAndHydrate(null, next);
    expect(out.habits).toEqual(next.habits);
    expect(out.categories).toEqual(DEFAULT_CATEGORIES);
  });

  it("keeps a record's position when it is edited", async () => {
    // Reassigning seq on write would make any edited habit jump to the end of
    // the user's list.
    const base = defaultDb(DEFAULT_CATEGORIES);
    const v1: Db = { ...base, habits: [habit("a"), habit("b"), habit("c")] };
    await applyChanges(diffDb(null, v1));

    const v2: Db = { ...v1, habits: v1.habits.map((h) => (h.id === "a" ? { ...h, name: "edited" } : h)) };
    await applyChanges(diffDb(v1, v2));

    const out = (await hydrate()).db;
    expect(out.habits.map((h) => h.id)).toEqual(["a", "b", "c"]);
    expect(out.habits[0].name).toBe("edited");
  });

  it("appends newly added records after existing ones", async () => {
    const base = defaultDb(DEFAULT_CATEGORIES);
    const v1: Db = { ...base, habits: [habit("a")] };
    await applyChanges(diffDb(null, v1));
    const v2: Db = { ...v1, habits: [...v1.habits, habit("b")] };
    await applyChanges(diffDb(v1, v2));

    const out = (await hydrate()).db;
    expect(out.habits.map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("hides deleted records but keeps the tombstone row", async () => {
    const base = defaultDb(DEFAULT_CATEGORIES);
    const v1: Db = { ...base, habits: [habit("a"), habit("b")] };
    await applyChanges(diffDb(null, v1));

    const v2: Db = { ...v1, habits: v1.habits.filter((h) => h.id !== "a") };
    await applyChanges(diffDb(v1, v2));

    const out = (await hydrate()).db;
    expect(out.habits.map((h) => h.id)).toEqual(["b"]);
    // The row survives: a delete has to be a record, not an absence, to sync.
    const row = await idb.habits.get("a");
    expect(row?.deleted).toBe(1);
  });

  it("writes nothing for an empty change set", async () => {
    await applyChanges([]);
    expect(await idb.habits.count()).toBe(0);
  });

  it("returns timerSessions newest-first, not in insertion order", async () => {
    // Regression: `live()` sorts by seq ASC (insertion order), but the UI
    // prepends sessions and renders `.slice(0, 6)` as "recent". After any reload
    // the history showed the OLDEST sessions, and the `.slice(0, 200)` trim
    // discarded the NEWEST ones.
    const base = defaultDb(DEFAULT_CATEGORIES);
    const session = (id: string, endedAt: number): TimerSession => ({
      id,
      mode: "free",
      focusSeconds: 60,
      startedAt: endedAt - 60_000,
      endedAt,
    });
    // Inserted oldest-first, so seq ascends with age.
    const v1: Db = {
      ...base,
      timerSessions: [session("oldest", 1_000), session("mid", 2_000), session("newest", 3_000)],
    };
    await applyChanges(diffDb(null, v1));

    const out = (await hydrate()).db;
    expect(out.timerSessions.map((s) => s.id)).toEqual(["newest", "mid", "oldest"]);
  });

  it("does not resurrect a deleted default category on the next boot", async () => {
    // Regression: hydrate used to fall back to the DEFAULT_CATEGORIES constant
    // whenever no live rows existed. Deleting a default wrote one tombstone, so
    // the next boot saw an empty live set and re-seeded all 16 — undoing the
    // delete. Defaults must be seeded as real rows instead.
    const first = await hydrate();
    expect(first.db.categories).toHaveLength(DEFAULT_CATEGORIES.length);

    const without: Db = { ...first.db, categories: first.db.categories.filter((c) => c.id !== "sport") };
    await applyChanges(diffDb(first.db, without));

    const second = await hydrate();
    expect(second.db.categories.map((c) => c.id)).not.toContain("sport");
    expect(second.db.categories).toHaveLength(DEFAULT_CATEGORIES.length - 1);
  });

  it("seeds default categories clean and unpushable", async () => {
    // Default categories have FIXED ids. Seeding them dirty at `now` means a
    // second device's fresh install pushes 16 pristine defaults that beat the
    // user's edited categories in LWW and wipe them server-side.
    const { db: seeded } = await hydrate();
    expect(seeded.categories).toHaveLength(DEFAULT_CATEGORIES.length);

    const rows = await idb.categories.toArray();
    expect(rows.every((r) => r.dirty === 0)).toBe(true);
    expect(rows.every((r) => r.updatedAt === 0)).toBe(true);
    expect(await pendingChanges()).toEqual({}); // nothing to push on a fresh install
  });

  it("marks a default dirty with a real timestamp once the user edits it", async () => {
    const { db: seeded } = await hydrate();
    const edited: Db = {
      ...seeded,
      categories: seeded.categories.map((c) => (c.id === "sport" ? { ...c, nameFa: "دویدن" } : c)),
    };
    await applyChanges(diffDb(seeded, edited));

    const row = await idb.categories.get("sport");
    expect(row?.dirty).toBe(1);
    expect(row?.updatedAt).toBeGreaterThan(0); // now beats another device's untouched seed
    expect((await pendingChanges()).categories).toHaveLength(1);
  });

  it("keeps a delete deleted even when every category is removed", async () => {
    const first = await hydrate();
    const empty: Db = { ...first.db, categories: [] };
    await applyChanges(diffDb(first.db, empty));

    const second = await hydrate();
    expect(second.db.categories).toEqual([]);
  });
});

describe("pendingChanges", () => {
  it("collects local edits into the outbox", async () => {
    const base = defaultDb(DEFAULT_CATEGORIES);
    const next: Db = { ...base, habits: [habit("h1")] };
    await applyChanges(diffDb(null, next));

    const pending = await pendingChanges();
    expect(pending.habits).toHaveLength(1);
    expect(pending.habits[0].key).toBe("h1");
    expect(pending.categories).toHaveLength(DEFAULT_CATEGORIES.length);
  });
});
