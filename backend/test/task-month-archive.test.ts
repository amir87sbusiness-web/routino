import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  expandTaskMonthArchive,
  isTaskMonthArchiveKind,
  postgresJsonbNumber,
  type StoredTaskMonthRecord,
} from "../src/services/task-month-archive.js";
import { validateSyncRecord } from "../src/services/sync-record-validation.js";

const task = (id: string, dateKey: string, title: string) => ({
  id,
  dateKey,
  title,
  type: "binary" as const,
  target: 1,
  value: 0,
  done: false,
});

// PostgreSQL jsonb renders object keys by key length then byte order, with
// comma/colon spaces. The production decoder must implement the same portable
// convention without Node crypto; this local fixture only gives its checksum a
// hand-independent source of truth.
const pgJsonbText = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(pgJsonbText).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}: ${pgJsonbText(item)}`).join(", ")}}`;
  }
  return JSON.stringify(value);
};
const md5 = (value: string) => createHash("md5").update(value).digest("hex");

const archiveItems = [
  ["t-1", 1000, task("t-1", "2026-01-02", "الف")],
  ["t-2", 2000, task("t-2", "2026-01-03", "ب")],
] as [string, number, unknown][];

const archiveData = {
  v: 1 as const,
  monthKey: "2026-01",
  count: 2,
  checksum: md5(
    archiveItems
      .map(([id, updatedAt, data]) => `${id}\n${updatedAt}\n${pgJsonbText(data)}`)
      .join("\n"),
  ),
  items: archiveItems,
};

const archive: StoredTaskMonthRecord = {
  kind: "taskMonths",
  id: `2026-01|${md5("t-1\nt-2")}`,
  data: archiveData,
  updatedAt: 2000,
  deleted: false,
  seq: 9,
};

describe("task-month archive codec", () => {
  it.each([
    [0, "0"],
    [-0, "0"],
    [1, "1"],
    [1.125, "1.125"],
    [1e-7, "0.0000001"],
    [-1e-7, "-0.0000001"],
    [Number.MIN_VALUE, `0.${"0".repeat(323)}5`],
    [1e9, "1000000000"],
    [1.2e21, "1200000000000000000000"],
    [-1.2e21, "-1200000000000000000000"],
  ])("renders PostgreSQL jsonb numeric text for %s", (value, expected) => {
    expect(postgresJsonbNumber(value)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite archive number %s",
    (value) => {
      expect(() => postgresJsonbNumber(value)).toThrow("invalid_task_month_archive");
    },
  );

  it("expands a v1 archive losslessly into ordinary task pull records", () => {
    expect(expandTaskMonthArchive(archive)).toEqual([
      {
        kind: "tasks",
        id: "t-1",
        data: task("t-1", "2026-01-02", "الف"),
        updatedAt: 1000,
        deleted: false,
        seq: 9,
      },
      {
        kind: "tasks",
        id: "t-2",
        data: task("t-2", "2026-01-03", "ب"),
        updatedAt: 2000,
        deleted: false,
        seq: 9,
      },
    ]);
  });

  it("rejects unsupported archive versions", () => {
    expect(() => expandTaskMonthArchive({ ...archive, data: { ...archiveData, v: 2 } })).toThrow(
      "unsupported_task_archive_version",
    );
  });

  it.each([
    ["archive id from another month", { ...archive, id: "2026-02|0001" }],
    ["non-matching count", { ...archive, data: { ...archiveData, count: 1 } }],
    ["non-lowercase checksum", { ...archive, data: { ...archiveData, checksum: "A".repeat(32) } }],
    ["malformed item tuple", { ...archive, data: { ...archiveData, items: [["t-1", 1000]] } }],
    [
      "non-integer item timestamp",
      {
        ...archive,
        data: { ...archiveData, items: [["t-1", 1.5, task("t-1", "2026-01-02", "الف")]] },
      },
    ],
    [
      "invalid task payload",
      {
        ...archive,
        data: {
          ...archiveData,
          items: [["t-1", 1000, { ...task("t-1", "2026-01-02", "الف"), title: "" }]],
        },
      },
    ],
    [
      "duplicate task ids",
      {
        ...archive,
        data: {
          ...archiveData,
          items: [
            ["t-1", 1000, task("t-1", "2026-01-02", "الف")],
            ["t-1", 2000, task("t-1", "2026-01-03", "ب")],
          ],
        },
      },
    ],
    [
      "task outside the archive month",
      {
        ...archive,
        data: { ...archiveData, items: [["t-1", 1000, task("t-1", "2026-02-02", "الف")]] },
      },
    ],
  ])("rejects %s", (_reason, malformed) => {
    expect(() => expandTaskMonthArchive(malformed as StoredTaskMonthRecord)).toThrow(
      "invalid_task_month_archive",
    );
  });

  it.each([
    ["deleted archive row", { ...archive, deleted: true }],
    ["zero items", { ...archive, data: { ...archiveData, count: 0, items: [] } }],
    [
      "more than 32 items",
      {
        ...archive,
        data: {
          ...archiveData,
          count: 33,
          items: Array.from({ length: 33 }, (_, index) => [
            `many-${index}`,
            index + 1,
            task(`many-${index}`, "2026-01-02", "کار"),
          ]),
        },
      },
    ],
    ["id with non-MD5 suffix", { ...archive, id: "2026-01|not-a-checksum" }],
    [
      "fake checksum with valid shape",
      { ...archive, data: { ...archiveData, checksum: "0".repeat(32) } },
    ],
    ["extra v1 field", { ...archive, data: { ...archiveData, unknown: true } }],
    ["record timestamp below item maximum", { ...archive, updatedAt: 1999 }],
  ])("fails closed for %s", (_reason, malformed) => {
    expect(() => expandTaskMonthArchive(malformed as StoredTaskMonthRecord)).toThrow(
      "invalid_task_month_archive",
    );
  });

  it("keeps the client validator closed to the internal stored kind", () => {
    expect(isTaskMonthArchiveKind("taskMonths")).toBe(true);
    expect(isTaskMonthArchiveKind("tasks")).toBe(false);
    expect(validateSyncRecord({ ...archive, seq: undefined } as never)).toMatchObject({
      ok: false,
      code: "bad_kind",
    });
  });
});
