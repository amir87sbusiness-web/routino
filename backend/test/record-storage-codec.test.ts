import { describe, expect, it } from "vitest";

const samples = [
  [
    "categories",
    "cat-1",
    {
      id: "cat-1",
      nameFa: "سلامتی",
      nameEn: "Health",
      color: "emerald",
      icon: "heart-pulse",
      isDefault: false,
      isLimit: true,
    },
  ],
  [
    "habits",
    "habit-1",
    {
      id: "habit-1",
      name: "مطالعه روزانه",
      categoryId: "cat-1",
      type: "quantity",
      target: 30,
      unit: "دقیقه",
      unitKind: "time",
      schedule: { kind: "weekdays", weekdays: [0, 2, 4] },
      monthlyGoal: 12,
      reminderTime: "20:30",
      deadlineTime: "19:45",
      createdAt: 1_725_000_000_000,
      archived: false,
    },
  ],
  [
    "habitMonths",
    "habit-1|2026-09",
    {
      habitId: "habit-1",
      monthKey: "2026-09",
      cells: {
        "01": { updatedAt: 1_725_000_000_001, deleted: false, value: 30, done: true },
        "02": {
          updatedAt: 1_725_000_000_002,
          deleted: false,
          value: 15,
          done: false,
          note: "نیمه‌کاره",
          mood: "خوب",
        },
        "03": { updatedAt: 1_725_000_000_003, deleted: true },
      },
    },
  ],
  [
    "tasks",
    "task-1",
    {
      id: "task-1",
      dateKey: "2026-09-14",
      title: "مرور برنامه هفتگی",
      type: "binary",
      target: 1,
      value: 1,
      done: true,
      reminderAt: null,
      deadlineAt: "2026-09-16T18:00",
      color: "blue",
      icon: "check",
    },
  ],
  [
    "timerSessions",
    "timer-1",
    {
      id: "timer-1",
      mode: "pomodoro",
      focusSeconds: 1500,
      startedAt: 1_725_000_000_000,
      endedAt: 1_725_001_500_000,
      linkedKind: "habit",
      linkedId: "habit-1",
      linkedLabel: "مطالعه روزانه",
    },
  ],
  [
    "journal",
    "2026-09-14",
    {
      dateKey: "2026-09-14",
      text: "امروز روی کارهای مهم تمرکز کردم و نتیجه خوب بود.",
      score: 8,
      mood: "آرام",
      updatedAt: 1_725_000_000_010,
    },
  ],
  [
    "taskMonths",
    "2026-08|archive-hash",
    {
      v: 2,
      monthKey: "2026-08",
      count: 1,
      checksum: "0123456789abcdef0123456789abcdef",
      items: [["task-old", 1_724_000_000_000, ["09", "کار قدیمی", "binary", 1, 1, {}]]],
    },
  ],
] as const;

describe("record storage codec", () => {
  it("round-trips every stored record kind without changing canonical objects", async () => {
    const { decodeRecordFromStorage, encodeRecordForStorage } =
      await import("../src/services/record-storage-codec.js");

    for (const [kind, id, canonical] of samples) {
      const stored = encodeRecordForStorage(kind, id, canonical);
      expect(Array.isArray(stored), kind).toBe(kind !== "taskMonths");
      expect(decodeRecordFromStorage(kind, id, stored), kind).toEqual(canonical);
      expect(decodeRecordFromStorage(kind, id, canonical), `${kind} legacy`).toEqual(canonical);
    }
  });

  it("preserves optional-property absence, explicit nulls, and habit-month tombstones", async () => {
    const { decodeRecordFromStorage, encodeRecordForStorage } =
      await import("../src/services/record-storage-codec.js");
    const task = {
      id: "task-min",
      dateKey: "2026-09-14",
      title: "کار",
      type: "binary",
      target: 1,
      value: 0,
      done: false,
      reminderAt: null,
      deadlineAt: null,
    };
    const month = {
      habitId: "habit-min",
      monthKey: "2026-09",
      cells: {
        "01": { updatedAt: 10, deleted: true },
        "02": { updatedAt: 11, deleted: false, value: 0, done: false, mood: "خوب" },
      },
    };

    expect(
      decodeRecordFromStorage(
        "tasks",
        "task-min",
        encodeRecordForStorage("tasks", "task-min", task),
      ),
    ).toEqual(task);
    expect(
      decodeRecordFromStorage(
        "habitMonths",
        "habit-min|2026-09",
        encodeRecordForStorage("habitMonths", "habit-min|2026-09", month),
      ),
    ).toEqual(month);
  });
});
