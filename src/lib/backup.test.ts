import { describe, expect, it, vi } from "vitest";
import {
  backupFilename,
  backupSummary,
  BackupError,
  buildBackup,
  parseBackup,
  restoreDb,
} from "./backup";
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb, logKey, type Db } from "./store";
import {
  archiveExpandedOneYearTasks,
  oneYearTaskFixture,
} from "../../test/helpers/task-archive-compat";

function seed(): Db {
  const db = defaultDb(DEFAULT_CATEGORIES);
  const habitId = "h1";
  return {
    ...db,
    auth: { phone: "989123334444", verifiedAt: 1000 },
    habits: [
      {
        id: habitId,
        name: "مطالعه",
        categoryId: "study",
        type: "quantity",
        target: 30,
        unitKind: "time",
        schedule: { kind: "daily" },
        monthlyGoal: null,
        reminderTime: null,
        createdAt: 1000,
      },
    ],
    logs: {
      [logKey(habitId, "2026-07-15")]: { habitId, dateKey: "2026-07-15", value: 30, done: true },
    },
    journal: {
      "2026-07-15": {
        dateKey: "2026-07-15",
        text: "روز خوبی بود",
        score: 8,
        mood: null,
        updatedAt: 2000,
      },
    },
  };
}

describe("buildBackup", () => {
  it("exports identical ordinary tasks after transparent archive expansion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
    try {
      const beforeDb = { ...seed(), tasks: oneYearTaskFixture() };
      const afterDb: Db = {
        ...beforeDb,
        tasks: archiveExpandedOneYearTasks(),
      };
      expect(afterDb.tasks).toEqual(beforeDb.tasks);
      expect(buildBackup(afterDb)).toEqual(buildBackup(beforeDb));
    } finally {
      vi.useRealTimers();
    }
  });

  it("round-trips portable content through JSON without loss", () => {
    const db = seed();
    const restored = JSON.parse(JSON.stringify(buildBackup(db))).db as Db;
    expect(restored.habits).toEqual(db.habits);
    expect(restored.logs).toEqual(db.logs);
    expect(restored.journal).toEqual(db.journal);
  });

  it("preserves the data a user would actually mourn", () => {
    const db = seed();
    const restored = JSON.parse(JSON.stringify(buildBackup(db))).db as Db;
    expect(restored.habits).toHaveLength(1);
    expect(restored.habits[0].name).toBe("مطالعه");
    expect(restored.logs["h1|2026-07-15"].value).toBe(30);
    expect(restored.journal["2026-07-15"].text).toBe("روز خوبی بود");
    expect(restored.auth).toBeNull();
    expect(restored.subscription).toBeNull();
    expect(restored.notifications).toEqual([]);
    expect(restored.meta.dataOwner).toBeNull();
  });

  it("is tagged so a future importer can recognise it", () => {
    const b = buildBackup(seed());
    expect(b.format).toBe("routino-backup");
    expect(b.formatVersion).toBe(1);
    expect(Date.parse(b.exportedAt)).not.toBeNaN();
  });
});

describe("backupFilename", () => {
  it("is dated and json", () => {
    expect(backupFilename(new Date(2026, 6, 15))).toBe("routino-backup-2026-07-15.json");
  });
});

describe("parseBackup", () => {
  it("accepts a file our own exporter produced", () => {
    const text = JSON.stringify(buildBackup(seed()));
    const parsed = parseBackup(text);
    expect(parsed.db.habits[0].name).toBe("مطالعه");
  });

  it("rejects non-JSON", () => {
    expect(() => parseBackup("not json {")).toThrow(BackupError);
  });

  it("rejects JSON that isn't a Routino backup", () => {
    expect(() => parseBackup(JSON.stringify({ hello: "world" }))).toThrow(BackupError);
    expect(() =>
      parseBackup(JSON.stringify({ format: "something-else", formatVersion: 1, db: {} })),
    ).toThrow(BackupError);
  });

  it("rejects a backup whose db is missing core collections", () => {
    expect(() =>
      parseBackup(
        JSON.stringify({ format: "routino-backup", formatVersion: 1, db: { habits: [] } }),
      ),
    ).toThrow(BackupError);
  });
});

describe("restoreDb", () => {
  it("replaces the user's content with the backup's", () => {
    const current = defaultDb(DEFAULT_CATEGORIES);
    const backup = buildBackup(seed());
    const next = restoreDb(current, backup);
    expect(next.habits).toHaveLength(1);
    expect(next.habits[0].name).toBe("مطالعه");
    expect(next.logs["h1|2026-07-15"].value).toBe(30);
    expect(next.journal["2026-07-15"].text).toBe("روز خوبی بود");
  });

  it("keeps this device's identity and device-local settings", () => {
    const current: Db = {
      ...defaultDb(DEFAULT_CATEGORIES),
      auth: { phone: "989120000000", verifiedAt: 5000 },
      subscription: { planId: "p1", startedAt: 1, expiresAt: 9_999_999_999_999 },
      settings: {
        ...defaultDb(DEFAULT_CATEGORIES).settings,
        theme: "dark",
        notificationsEnabled: false,
      },
    };
    const backup = buildBackup(seed()); // seed()'s auth is a DIFFERENT phone
    const next = restoreDb(current, backup);
    // identity + entitlement stay with the current device
    expect(next.auth?.phone).toBe("989120000000");
    expect(next.subscription?.planId).toBe("p1");
    // device-local prefs stay
    expect(next.settings.theme).toBe("dark");
    expect(next.settings.notificationsEnabled).toBe(false);
  });

  it("does not blank out data a partial backup omits", () => {
    const current = restoreDb(defaultDb(DEFAULT_CATEGORIES), buildBackup(seed()));
    // a hand-trimmed backup that only carries habits
    const partial = {
      format: "routino-backup" as const,
      formatVersion: 1 as const,
      exportedAt: new Date().toISOString(),
      db: { habits: [], categories: [], logs: {}, settings: {} },
    } as unknown as ReturnType<typeof buildBackup>;
    const next = restoreDb(current, partial);
    // Keys the file never mentions keep what the device already has. This used
    // to assert [] / {} — the opposite of the test's own name and of restoreDb's
    // docstring — so a truncated backup silently deleted tasks and journal
    // entries on the one feature meant to get data back.
    expect(next.tasks).toEqual(current.tasks);
    expect(next.journal).toEqual(current.journal);
    expect(next.timerSessions).toEqual(current.timerSessions);
    // ...while a key that IS present, even empty, still replaces: that is a real
    // statement about the backed-up state, not a gap in the file.
    expect(next.habits).toEqual([]);
    // settings the partial omits fall back to current, not undefined
    expect(next.settings.lang).toBe(current.settings.lang);
  });

  it("round-trips: export then restore yields the same content", () => {
    const original = seed();
    const backup = JSON.parse(JSON.stringify(buildBackup(original))) as ReturnType<
      typeof buildBackup
    >;
    const next = restoreDb(defaultDb(DEFAULT_CATEGORIES), backup);
    expect(next.habits).toEqual(original.habits);
    expect(next.logs).toEqual(original.logs);
    expect(next.journal).toEqual(original.journal);
  });
});

describe("backupSummary", () => {
  it("counts what the user cares about", () => {
    const sum = backupSummary(seed());
    expect(sum.habits).toBe(1);
    expect(sum.logs).toBe(1);
    expect(sum.journal).toBe(1);
  });
});
