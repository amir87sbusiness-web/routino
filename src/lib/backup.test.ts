import { describe, expect, it } from "vitest";
import { backupFilename, buildBackup } from "./backup";
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb, logKey, type Db } from "./store";

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
      "2026-07-15": { dateKey: "2026-07-15", text: "روز خوبی بود", score: 8, mood: null, updatedAt: 2000 },
    },
  };
}

describe("buildBackup", () => {
  it("round-trips the whole db through JSON without loss", () => {
    const db = seed();
    const restored = JSON.parse(JSON.stringify(buildBackup(db))).db as Db;
    expect(restored).toEqual(db);
  });

  it("preserves the data a user would actually mourn", () => {
    const db = seed();
    const restored = JSON.parse(JSON.stringify(buildBackup(db))).db as Db;
    expect(restored.habits).toHaveLength(1);
    expect(restored.habits[0].name).toBe("مطالعه");
    expect(restored.logs["h1|2026-07-15"].value).toBe(30);
    expect(restored.journal["2026-07-15"].text).toBe("روز خوبی بود");
    expect(restored.auth?.phone).toBe("989123334444");
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
