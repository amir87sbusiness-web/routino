import { describe, expect, it } from "vitest";
import {
  MAX_JOURNAL_CHARACTERS,
  validateSyncRecord,
  type SyncRejectionCode,
} from "../src/services/sync-record-validation.js";

const base = <T>(kind: string, id: string, data: T) => ({
  kind,
  id,
  data,
  updatedAt: 1_000,
  deleted: false,
});

const valid = {
  categories: base("categories", "c1", {
    id: "c1",
    nameFa: "سلامتی",
    nameEn: "Health",
    color: "#10b981",
    icon: "heart",
    isDefault: false,
    isLimit: true,
  }),
  habits: base("habits", "h1", {
    id: "h1",
    name: "مطالعه",
    categoryId: "c1",
    type: "quantity",
    target: 30,
    unit: "دقیقه",
    unitKind: "time",
    schedule: { kind: "weekdays", weekdays: [0, 2, 4] },
    monthlyGoal: 12,
    reminderTime: "21:30",
    createdAt: 900,
    archived: false,
  }),
  logs: base("logs", "h1|2026-08-31", {
    habitId: "h1",
    dateKey: "2026-08-31",
    value: 30,
    done: true,
    note: "انجام شد",
    mood: "🙂",
  }),
  tasks: base("tasks", "t1", {
    id: "t1",
    dateKey: "2026-08-31",
    title: "تماس",
    type: "binary",
    target: 1,
    value: 1,
    done: true,
    note: "یادداشت",
    reminderAt: "2026-08-31T21:30",
    color: "#10b981",
    icon: "phone",
  }),
  timerSessions: base("timerSessions", "s1", {
    id: "s1",
    mode: "pomodoro",
    focusSeconds: 1_500,
    startedAt: 1_000,
    endedAt: 2_500,
    linkedKind: "habit",
    linkedId: "h1",
    linkedLabel: "مطالعه",
  }),
  journal: base("journal", "2026-08-31", {
    dateKey: "2026-08-31",
    text: "امروز خوب بود 🙂",
    score: 8,
    mood: "🙂",
    updatedAt: 1_000,
  }),
} as const;

const rejectCode = (record: Parameters<typeof validateSyncRecord>[0]): SyncRejectionCode | null => {
  const result = validateSyncRecord(record);
  return result.ok ? null : result.code;
};

describe("validateSyncRecord", () => {
  it("accepts every live product record shape used by the client", () => {
    for (const record of Object.values(valid)) {
      expect(validateSyncRecord(record)).toEqual({ ok: true, record });
    }
  });

  it("accepts a tombstone without requiring entity data", () => {
    const record = { ...valid.habits, data: null, deleted: true };
    expect(validateSyncRecord(record)).toEqual({ ok: true, record });
  });

  it("rejects unknown kinds, malformed ids, and invalid timestamps with stable codes", () => {
    expect(rejectCode({ ...valid.habits, kind: "passwords" })).toBe("bad_kind");
    expect(rejectCode({ ...valid.habits, id: "../../etc/passwd" })).toBe("bad_id");
    expect(rejectCode({ ...valid.habits, updatedAt: Number.NaN })).toBe("bad_updated_at");
    expect(rejectCode({ ...valid.habits, updatedAt: -1 })).toBe("bad_updated_at");
  });

  it("rejects unexpected keys and invalid domain enums or numbers", () => {
    expect(rejectCode({ ...valid.habits, data: { ...valid.habits.data, injected: "x" } })).toBe(
      "invalid_record",
    );
    expect(rejectCode({ ...valid.habits, data: { ...valid.habits.data, type: "money" } })).toBe(
      "invalid_record",
    );
    expect(
      rejectCode({
        ...valid.tasks,
        data: { ...valid.tasks.data, value: Number.POSITIVE_INFINITY },
      }),
    ).toBe("invalid_record");
  });

  it("cross-checks natural ids against the payload", () => {
    expect(rejectCode({ ...valid.habits, data: { ...valid.habits.data, id: "other" } })).toBe(
      "invalid_record",
    );
    expect(rejectCode({ ...valid.logs, data: { ...valid.logs.data, dateKey: "2026-08-30" } })).toBe(
      "invalid_record",
    );
    expect(
      rejectCode({ ...valid.journal, data: { ...valid.journal.data, dateKey: "2026-08-30" } }),
    ).toBe("invalid_record");
  });

  it("rejects impossible dates, times, and weekday schedules", () => {
    expect(rejectCode({ ...valid.journal, id: "2026-02-30" })).toBe("bad_id");
    expect(
      rejectCode({ ...valid.habits, data: { ...valid.habits.data, reminderTime: "25:99" } }),
    ).toBe("invalid_record");
    expect(
      rejectCode({
        ...valid.habits,
        data: {
          ...valid.habits.data,
          schedule: { kind: "weekdays", weekdays: [1, 1, 8] },
        },
      }),
    ).toBe("invalid_record");
  });

  it("bounds journal characters and actual UTF-8 bytes", () => {
    expect(
      rejectCode({
        ...valid.journal,
        data: { ...valid.journal.data, text: "x".repeat(MAX_JOURNAL_CHARACTERS + 1) },
      }),
    ).toBe("record_too_large");
    expect(
      rejectCode({
        ...valid.journal,
        data: { ...valid.journal.data, text: "🙂".repeat(MAX_JOURNAL_CHARACTERS) },
      }),
    ).toBe("record_too_large");
  });

  it("bounds notes and identifiers without echoing their values", () => {
    expect(
      rejectCode({ ...valid.logs, data: { ...valid.logs.data, note: "x".repeat(4_001) } }),
    ).toBe("invalid_record");
    expect(
      rejectCode({ ...valid.habits, data: { ...valid.habits.data, name: "x".repeat(257) } }),
    ).toBe("invalid_record");
  });
});
