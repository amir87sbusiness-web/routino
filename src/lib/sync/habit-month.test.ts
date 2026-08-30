import { describe, expect, it } from "vitest";
import type { RecordRow } from "../db/dexie";
import type { HabitLog } from "../store";
import {
  expandHabitMonthRecord,
  habitMonthId,
  packHabitLogRows,
  type HabitMonthData,
} from "./habit-month";

const logRow = (
  habitId: string,
  dateKey: string,
  updatedAt: number,
  over: Partial<RecordRow<HabitLog>> = {},
): RecordRow<HabitLog> => ({
  key: `${habitId}|${dateKey}`,
  data: { habitId, dateKey, value: 1, done: true },
  updatedAt,
  deleted: 0,
  dirty: 1,
  seq: updatedAt,
  ...over,
});

describe("habit-month wire codec", () => {
  it("uses one canonical row id per habit and calendar month", () => {
    expect(habitMonthId("habit-1", "2026-08-31")).toBe("habit-1|2026-08");
  });

  it("packs different days from the same month into independent timestamped cells", () => {
    const rows = [
      logRow("h1", "2026-08-01", 100),
      logRow("h1", "2026-08-02", 200, { data: null as never, deleted: 1 }),
    ];

    const [packet] = packHabitLogRows(rows);

    expect(packet?.record).toEqual({
      kind: "habitMonths",
      id: "h1|2026-08",
      data: {
        habitId: "h1",
        monthKey: "2026-08",
        cells: {
          "01": { value: 1, done: true, updatedAt: 100, deleted: false },
          "02": { updatedAt: 200, deleted: true },
        },
      },
      updatedAt: 200,
      deleted: false,
    });
    expect(packet?.sources).toEqual(rows);
  });

  it("never combines different habits or months", () => {
    const packets = packHabitLogRows([
      logRow("h1", "2026-08-01", 1),
      logRow("h1", "2026-09-01", 2),
      logRow("h2", "2026-08-01", 3),
    ]);

    expect(packets.map((packet) => packet.record.id).sort()).toEqual([
      "h1|2026-08",
      "h1|2026-09",
      "h2|2026-08",
    ]);
  });

  it("splits a month by actual UTF-8 bytes while preserving every source row", () => {
    const rows = [
      logRow("h1", "2026-08-01", 1, {
        data: {
          habitId: "h1",
          dateKey: "2026-08-01",
          value: 1,
          done: true,
          note: "ژ".repeat(200),
        },
      }),
      logRow("h1", "2026-08-02", 2, {
        data: {
          habitId: "h1",
          dateKey: "2026-08-02",
          value: 1,
          done: true,
          note: "ژ".repeat(200),
        },
      }),
    ];

    const packets = packHabitLogRows(rows, 700);

    expect(packets).toHaveLength(2);
    expect(packets.flatMap((packet) => packet.sources)).toEqual(rows);
    for (const packet of packets) {
      expect(
        new TextEncoder().encode(JSON.stringify(packet.record)).byteLength,
      ).toBeLessThanOrEqual(700);
    }
  });

  it("expands a complete remote month back into the unchanged local daily model", () => {
    const data: HabitMonthData = {
      habitId: "h1",
      monthKey: "2026-08",
      cells: {
        "01": {
          value: 1,
          done: true,
          updatedAt: 100,
          deleted: false,
        },
        "02": { updatedAt: 200, deleted: true },
      },
    };

    expect(
      expandHabitMonthRecord({
        kind: "habitMonths",
        id: "h1|2026-08",
        data,
        updatedAt: 200,
        deleted: false,
        seq: 9,
      }),
    ).toEqual([
      {
        kind: "logs",
        id: "h1|2026-08-01",
        data: { habitId: "h1", dateKey: "2026-08-01", value: 1, done: true },
        updatedAt: 100,
        deleted: false,
        seq: 9,
      },
      {
        kind: "logs",
        id: "h1|2026-08-02",
        data: null,
        updatedAt: 200,
        deleted: true,
        seq: 9,
      },
    ]);
  });

  it("represents a deleted remote month as a scoped local cleanup instruction", () => {
    expect(
      expandHabitMonthRecord({
        kind: "habitMonths",
        id: "h1|2026-08",
        data: null,
        updatedAt: 300,
        deleted: true,
        seq: 10,
      }),
    ).toEqual([]);
  });
});
