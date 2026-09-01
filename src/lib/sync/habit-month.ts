import type { RemoteRecord, SyncRecord } from "../api/sync";
import type { RecordRow } from "../db/dexie";
import type { HabitLog } from "../store";

export const MAX_HABIT_MONTH_CELLS = 31;
export const MAX_HABIT_MONTH_PACKET_BYTES = 40 * 1024;

export interface HabitMonthCell {
  updatedAt: number;
  deleted: boolean;
  value?: number;
  done?: boolean;
  note?: string;
  mood?: string;
}

export interface HabitMonthData {
  habitId: string;
  monthKey: string;
  cells: Record<string, HabitMonthCell>;
}

export interface PackedHabitMonth {
  record: SyncRecord;
  sources: RecordRow<HabitLog>[];
}

const encoder = new TextEncoder();

export function habitMonthId(habitId: string, dateKey: string): string {
  return `${habitId}|${dateKey.slice(0, 7)}`;
}

function packetFor(
  habitId: string,
  monthKey: string,
  rows: RecordRow<HabitLog>[],
): PackedHabitMonth {
  const cells: Record<string, HabitMonthCell> = {};
  let updatedAt = 0;
  for (const row of rows) {
    const dateKey = row.key.slice(row.key.lastIndexOf("|") + 1);
    const day = dateKey.slice(8, 10);
    if (row.deleted) {
      cells[day] = { updatedAt: row.updatedAt, deleted: true };
    } else {
      if (row.data === null) throw new Error("live_habit_log_missing_data");
      cells[day] = {
          updatedAt: row.updatedAt,
          deleted: false,
          value: row.data.value,
          done: row.data.done,
          ...(row.data.note === undefined ? {} : { note: row.data.note }),
          ...(row.data.mood === undefined ? {} : { mood: row.data.mood }),
        };
    }
    updatedAt = Math.max(updatedAt, row.updatedAt);
  }
  return {
    record: {
      kind: "habitMonths",
      id: `${habitId}|${monthKey}`,
      data: { habitId, monthKey, cells } satisfies HabitMonthData,
      updatedAt,
      deleted: false,
    },
    sources: rows,
  };
}

function wireBytes(packet: PackedHabitMonth): number {
  return encoder.encode(JSON.stringify(packet.record)).byteLength;
}

/** Groups local daily rows into bounded partial month packets.
 *
 * A packet contains only the dirty cells being sent. The server merges them
 * into its complete month row; this keeps an ordinary daily edit tiny while a
 * first import can stream a large month over several requests.
 */
export function packHabitLogRows(
  rows: RecordRow<HabitLog>[],
  maxPacketBytes = MAX_HABIT_MONTH_PACKET_BYTES,
): PackedHabitMonth[] {
  const groups = new Map<
    string,
    { habitId: string; monthKey: string; rows: RecordRow<HabitLog>[] }
  >();
  for (const row of [...rows].sort((a, b) => a.key.localeCompare(b.key))) {
    const separator = row.key.lastIndexOf("|");
    const habitId = row.key.slice(0, separator);
    const dateKey = row.key.slice(separator + 1);
    const monthKey = dateKey.slice(0, 7);
    const id = `${habitId}|${monthKey}`;
    const group = groups.get(id);
    if (group) group.rows.push(row);
    else groups.set(id, { habitId, monthKey, rows: [row] });
  }

  const packets: PackedHabitMonth[] = [];
  for (const group of groups.values()) {
    let current: RecordRow<HabitLog>[] = [];
    for (const source of group.rows) {
      const candidate = [...current, source];
      const candidatePacket = packetFor(group.habitId, group.monthKey, candidate);
      if (
        current.length > 0 &&
        (candidate.length > MAX_HABIT_MONTH_CELLS || wireBytes(candidatePacket) > maxPacketBytes)
      ) {
        packets.push(packetFor(group.habitId, group.monthKey, current));
        current = [source];
      } else {
        current = candidate;
      }
    }
    if (current.length) packets.push(packetFor(group.habitId, group.monthKey, current));
  }
  return packets;
}

/** Converts one complete server month back to the daily records IndexedDB and
 * the UI have always used. Deleted month rows are handled with a scoped local
 * scan by the sync engine because a month tombstone intentionally has no body.
 */
export function expandHabitMonthRecord(record: RemoteRecord): RemoteRecord[] {
  if (record.kind !== "habitMonths" || record.deleted || !record.data) return [];
  const month = record.data as HabitMonthData;
  return Object.entries(month.cells)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, cell]) => {
      const dateKey = `${month.monthKey}-${day}`;
      return {
        kind: "logs",
        id: `${month.habitId}|${dateKey}`,
        data: cell.deleted
          ? null
          : {
              habitId: month.habitId,
              dateKey,
              value: cell.value,
              done: cell.done,
              ...(cell.note === undefined ? {} : { note: cell.note }),
              ...(cell.mood === undefined ? {} : { mood: cell.mood }),
            },
        updatedAt: cell.updatedAt,
        deleted: cell.deleted,
        seq: record.seq,
      };
    });
}
