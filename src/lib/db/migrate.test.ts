import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "../presets";
import { defaultDb, logKey, type Db } from "../store";
import { db as idb } from "./dexie";
import { hydrate } from "./hydrate";
import { defaultLocal, loadLocal, saveLocal } from "./local";
import { hasLegacyBlob, migrateLegacyBlob } from "./migrate";

const LEGACY_KEY = "routino:v1";
const MIGRATED_KEY = "routino:v1:migrated";

/** A blob shaped like one a real v1.0 install would hold, including the dropped
 * `admin`/`badges` keys that older installs still carry. */
function legacyBlob(): Db & { admin: unknown; badges: unknown } {
  const base = defaultDb(DEFAULT_CATEGORIES);
  return {
    ...base,
    settings: {
      ...base.settings,
      lang: "en",
      calendar: "gregorian",
      theme: "dark",
      onboarded: true,
      notificationsEnabled: false,
    },
    auth: { phone: "989123334444", verifiedAt: 111 },
    subscription: { planId: "m3", startedAt: 1, expiresAt: 2, trial: true },
    habits: [
      {
        id: "h1",
        name: "مطالعه",
        categoryId: "study",
        type: "quantity",
        target: 30,
        unitKind: "time",
        schedule: { kind: "daily" },
        monthlyGoal: 20,
        reminderTime: "08:00",
        createdAt: 5,
      },
    ],
    logs: {
      [logKey("h1", "2026-07-15")]: { habitId: "h1", dateKey: "2026-07-15", value: 30, done: true },
    },
    tasks: [
      {
        id: "t1",
        dateKey: "2026-07-15",
        title: "خرید",
        type: "binary",
        target: 1,
        value: 0,
        done: false,
      },
    ],
    timerSessions: [{ id: "s1", mode: "free", focusSeconds: 60, startedAt: 1, endedAt: 2 }],
    journal: {
      "2026-07-15": {
        dateKey: "2026-07-15",
        text: "روز خوبی بود",
        score: 8,
        mood: null,
        updatedAt: 9,
      },
    },
    notifications: [{ id: "n1", title: "t", body: "b", at: 1, read: false }],
    meta: { ...base.meta, sessions: 42, celebrated: ["h1|2026-07-01|70"], firedReminders: ["x"] },
    admin: { username: "admin", password: "admin123" },
    badges: [],
  };
}

beforeEach(async () => {
  localStorage.clear();
  await Promise.all(idb.tables.map((t) => t.clear()));
});

describe("migrateLegacyBlob", () => {
  it("does nothing when there is no blob", async () => {
    expect(hasLegacyBlob()).toBe(false);
    expect(await migrateLegacyBlob()).toBe(false);
  });

  it("imports every entity and marks them all dirty for a later push", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyBlob()));
    expect(await migrateLegacyBlob()).toBe(true);

    expect(await idb.habits.count()).toBe(1);
    expect(await idb.logs.count()).toBe(1);
    expect(await idb.tasks.count()).toBe(1);
    expect(await idb.timerSessions.count()).toBe(1);
    expect(await idb.journal.count()).toBe(1);
    expect(await idb.categories.count()).toBe(DEFAULT_CATEGORIES.length);

    for (const table of idb.tables) {
      const rows = await table.toArray();
      expect(
        rows.every((r) => r.dirty === 1),
        table.name,
      ).toBe(true);
    }
  });

  it("NEVER deletes the original blob", async () => {
    const raw = JSON.stringify(legacyBlob());
    localStorage.setItem(LEGACY_KEY, raw);
    await migrateLegacyBlob();
    expect(localStorage.getItem(LEGACY_KEY)).toBe(raw);
  });

  it("is idempotent — a second boot does not re-import", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyBlob()));
    expect(await migrateLegacyBlob()).toBe(true);
    expect(localStorage.getItem(MIGRATED_KEY)).toBeTruthy();
    expect(hasLegacyBlob()).toBe(false);
    expect(await migrateLegacyBlob()).toBe(false);
    expect(await idb.habits.count()).toBe(1);
  });

  it("carries the subscription across so users are not locked out", async () => {
    // The highest-consequence failure available: a user's trial/paid status only
    // exists in this blob. Losing it bounces every existing user to the paywall
    // on their next launch.
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyBlob()));
    await migrateLegacyBlob();

    expect(loadLocal().subscription).toEqual({
      planId: "m3",
      startedAt: 1,
      expiresAt: 2,
      trial: true,
    });
    expect((await hydrate()).db.subscription).toEqual({
      planId: "m3",
      startedAt: 1,
      expiresAt: 2,
      trial: true,
    });
  });

  it("routes device-local fields to local storage, not IndexedDB", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyBlob()));
    await migrateLegacyBlob();

    const local = loadLocal();
    expect(local.auth?.phone).toBe("989123334444");
    expect(local.meta.sessions).toBe(42);
    expect(local.meta.celebrated).toEqual(["h1|2026-07-01|70"]);
    expect(local.settings).toEqual(legacyBlob().settings);
    expect(idb.tables.map((table) => table.name)).not.toContain("settings");
  });

  it("defaults a legacy blob with no notification preference to off", async () => {
    const blob = legacyBlob();
    delete (blob.settings as Partial<Db["settings"]>).notificationsEnabled;
    localStorage.setItem(LEGACY_KEY, JSON.stringify(blob));

    await migrateLegacyBlob();

    expect(loadLocal().settings.notificationsEnabled).toBe(false);
  });

  it("defaults new device feedback preferences on for an older local install", async () => {
    const blob = legacyBlob();
    delete (blob.settings as Partial<Db["settings"]>).completionSoundEnabled;
    delete (blob.settings as Partial<Db["settings"]>).hapticsEnabled;
    localStorage.setItem(LEGACY_KEY, JSON.stringify(blob));

    await migrateLegacyBlob();

    expect(loadLocal().settings.completionSoundEnabled).toBe(true);
    expect(loadLocal().settings.hapticsEnabled).toBe(true);
  });

  it("keeps an existing user's explicit feedback choices", async () => {
    const blob = legacyBlob();
    blob.settings.completionSoundEnabled = false;
    blob.settings.hapticsEnabled = false;
    localStorage.setItem(LEGACY_KEY, JSON.stringify(blob));

    await migrateLegacyBlob();

    expect(loadLocal().settings.completionSoundEnabled).toBe(false);
    expect(loadLocal().settings.hapticsEnabled).toBe(false);
  });

  it("stamps updatedAt from the entity's own timestamp, not the import time", async () => {
    // Stamping everything `now` makes an old blob win every LWW conflict against
    // an account that already has newer server data — and resurrect deleted
    // habits. A habit created in 2024 must carry 2024.
    const now = 9_000_000;
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyBlob()));
    await migrateLegacyBlob(now);

    expect((await idb.habits.get("h1"))?.updatedAt).toBe(5); // habit.createdAt
    expect((await idb.journal.get("2026-07-15"))?.updatedAt).toBe(9); // journal.updatedAt
    expect((await idb.timerSessions.get("s1"))?.updatedAt).toBe(2); // session.endedAt

    // No timestamp on the entity -> import time is the only option.
    expect((await idb.tasks.get("t1"))?.updatedAt).toBe(now);
  });

  it("gives default categories updatedAt 0 so they never clobber another device", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyBlob()));
    await migrateLegacyBlob(9_000_000);
    const rows = await idb.categories.toArray();
    expect(rows.every((r) => r.data?.isDefault === true)).toBe(true);
    expect(rows.every((r) => r.updatedAt === 0)).toBe(true);
  });

  it("survives an unparseable blob without retrying forever", async () => {
    localStorage.setItem(LEGACY_KEY, "{ not json");
    expect(await migrateLegacyBlob()).toBe(false);
    expect(localStorage.getItem(MIGRATED_KEY)).toBeTruthy(); // won't retry
    expect(localStorage.getItem(LEGACY_KEY)).toBe("{ not json"); // still recoverable
  });
});

describe("hydrate after migration", () => {
  it("reconstructs a Db indistinguishable from the blob's user data", async () => {
    const blob = legacyBlob();
    localStorage.setItem(LEGACY_KEY, JSON.stringify(blob));

    const { db, migrated } = await hydrate();
    expect(migrated).toBe(true);

    expect(db.habits).toEqual(blob.habits);
    expect(db.logs).toEqual(blob.logs);
    expect(db.tasks).toEqual(blob.tasks);
    expect(db.timerSessions).toEqual(blob.timerSessions);
    expect(db.journal).toEqual(blob.journal);
    expect(db.categories).toEqual(blob.categories);
    expect(db.auth).toEqual(blob.auth);
    expect(db.notifications).toEqual(blob.notifications);
    expect(db.meta).toEqual(blob.meta);
  });

  it("preserves list order instead of falling back to primary-key order", async () => {
    // IndexedDB returns rows sorted by key. Without an explicit ordering field
    // categories would come back alphabetically by id (daily, faith, family…)
    // rather than in their curated order, and habits/tasks in random uid order.
    const blob = legacyBlob();
    blob.habits = [
      { ...blob.habits[0], id: "zzz", name: "آخری" },
      { ...blob.habits[0], id: "aaa", name: "اولی" },
    ];
    localStorage.setItem(LEGACY_KEY, JSON.stringify(blob));

    const { db } = await hydrate();
    expect(db.categories.map((c) => c.id)).toEqual(DEFAULT_CATEGORIES.map((c) => c.id));
    expect(db.habits.map((h) => h.id)).toEqual(["zzz", "aaa"]); // insertion order, not sorted
  });

  it("restores the complete local settings object", async () => {
    const blob = legacyBlob();
    localStorage.setItem(LEGACY_KEY, JSON.stringify(blob));
    const { db } = await hydrate();

    expect(db.settings).toEqual(blob.settings);
  });

  it("gives a fresh install seeded categories rather than an empty list", async () => {
    const { db, migrated } = await hydrate();
    expect(migrated).toBe(false);
    expect(db.categories).toEqual(DEFAULT_CATEGORIES);
    expect(db.habits).toEqual([]);
    expect(db.settings.notificationsEnabled).toBe(false);
    expect(db.settings.completionSoundEnabled).toBe(true);
    expect(db.settings.hapticsEnabled).toBe(true);
  });

  it("retains an existing device preference that explicitly enabled notifications", async () => {
    const local = defaultLocal();
    saveLocal({ ...local, settings: { ...local.settings, notificationsEnabled: true } });

    const { db } = await hydrate();

    expect(db.settings.notificationsEnabled).toBe(true);
  });

  it("drops the legacy admin credential instead of carrying it forward", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyBlob()));
    const { db } = await hydrate();
    expect("admin" in db).toBe(false);
    expect("badges" in db).toBe(false);
  });
});

describe("a blob that predates some settings fields", () => {
  it("keeps the defaults instead of storing undefined over them", async () => {
    // `brandColor` and `journalReminder` were added after the first release, so
    // an older install's blob simply has no such key. Writing a row for every
    // SYNCED_SETTING_KEY regardless stored `{ value: undefined }`, and because
    // mergeSettings spreads that over the defaults — and a spread copies a key
    // even when its value is undefined — the real default was replaced with
    // nothing. Concretely: journalReminder became undefined instead of "22:00"
    // and the journal reminder silently stopped firing after an update.
    const base = defaultDb(DEFAULT_CATEGORIES);
    const old = {
      ...base,
      settings: {
        lang: "en",
        calendar: "gregorian",
        theme: "dark",
        onboarded: true,
        notificationsEnabled: false,
      },
    };
    localStorage.setItem(LEGACY_KEY, JSON.stringify(old));
    localStorage.removeItem(MIGRATED_KEY);

    const { db } = await hydrate();

    expect(db.settings.brandColor).toBe(base.settings.brandColor);
    expect(db.settings.journalReminder).toBe(base.settings.journalReminder);
    // ...and the keys the blob DID carry still win over the defaults.
    expect(db.settings.lang).toBe("en");
    expect(db.settings.calendar).toBe("gregorian");
  });
});
