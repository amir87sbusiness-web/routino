// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import type { StoredSyncKind } from "../db/schema.ts";

type JsonObject = Record<string, unknown>;

const hasOwn = (value: JsonObject, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function objectValue(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_record_storage");
  }
  return value as JsonObject;
}

function arrayValue(value: unknown, min: number, max = min): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error("invalid_record_storage");
  }
  return value;
}

function optionalFields(data: JsonObject, keys: readonly string[]): JsonObject {
  return Object.fromEntries(keys.filter((key) => hasOwn(data, key)).map((key) => [key, data[key]]));
}

function appendExtras(base: unknown[], extras: JsonObject): unknown[] {
  return Object.keys(extras).length ? [...base, extras] : base;
}

function compactHabitMonthCells(cells: unknown): JsonObject {
  return Object.fromEntries(
    Object.entries(objectValue(cells)).map(([day, rawCell]) => {
      const cell = objectValue(rawCell);
      if (cell.deleted === true) return [day, [cell.updatedAt]];
      const compact: unknown[] = [cell.updatedAt, cell.value, cell.done];
      if (hasOwn(cell, "note") || hasOwn(cell, "mood")) compact.push(cell.note ?? null);
      if (hasOwn(cell, "mood")) compact.push(cell.mood);
      return [day, compact];
    }),
  );
}

function expandHabitMonthCells(cells: unknown): JsonObject {
  return Object.fromEntries(
    Object.entries(objectValue(cells)).map(([day, rawCell]) => {
      const cell = arrayValue(rawCell, 1, 5);
      if (cell.length === 1) return [day, { updatedAt: cell[0], deleted: true }];
      if (cell.length < 3) throw new Error("invalid_record_storage");
      return [
        day,
        {
          updatedAt: cell[0],
          deleted: false,
          value: cell[1],
          done: cell[2],
          ...(cell.length >= 4 && cell[3] !== null ? { note: cell[3] } : {}),
          ...(cell.length >= 5 ? { mood: cell[4] } : {}),
        },
      ];
    }),
  );
}

/** Converts canonical client data into the compact JSON array stored in Postgres. */
export function encodeRecordForStorage(kind: StoredSyncKind, _id: string, value: unknown): unknown {
  if (kind === "taskMonths") return value;
  if (value === null) return null;
  if (Array.isArray(value)) return value;
  const data = objectValue(value);

  switch (kind) {
    case "categories": {
      const compact = [data.nameFa, data.nameEn, data.color, data.icon, data.isDefault];
      if (hasOwn(data, "isLimit")) compact.push(data.isLimit);
      return compact;
    }
    case "habits": {
      const schedule = objectValue(data.schedule);
      const compactSchedule = [schedule.kind];
      if (hasOwn(schedule, "weekdays")) compactSchedule.push(schedule.weekdays);
      return appendExtras(
        [
          data.name,
          data.categoryId,
          data.type,
          data.target,
          compactSchedule,
          data.monthlyGoal,
          data.reminderTime,
          data.createdAt,
        ],
        optionalFields(data, ["unit", "unitKind", "archived", "deadlineTime"]),
      );
    }
    case "habitMonths":
      return [compactHabitMonthCells(data.cells)];
    case "tasks":
      return appendExtras(
        [data.dateKey, data.title, data.type, data.target, data.value, data.done],
        optionalFields(data, ["note", "unitKind", "reminderAt", "deadlineAt", "color", "icon"]),
      );
    case "timerSessions":
      return appendExtras(
        [data.mode, data.focusSeconds, data.startedAt, data.endedAt],
        optionalFields(data, ["linkedKind", "linkedId", "linkedLabel"]),
      );
    case "journal":
      return [data.text, data.score, data.mood, data.updatedAt];
  }
}

/** Restores either legacy objects or compact arrays to the unchanged wire object. */
export function decodeRecordFromStorage(kind: StoredSyncKind, id: string, value: unknown): unknown {
  // Archive V2 already compacts its high-volume task payloads positionally.
  // Keep its object envelope so the separately staged archive rollout and
  // recovery tooling do not acquire a second storage format.
  if (kind === "taskMonths") return value;
  if (value === null || (!Array.isArray(value) && typeof value === "object")) return value;

  switch (kind) {
    case "categories": {
      const data = arrayValue(value, 5, 6);
      return {
        id,
        nameFa: data[0],
        nameEn: data[1],
        color: data[2],
        icon: data[3],
        isDefault: data[4],
        ...(data.length === 6 ? { isLimit: data[5] } : {}),
      };
    }
    case "habits": {
      const data = arrayValue(value, 8, 9);
      const schedule = arrayValue(data[4], 1, 2);
      const extras = data.length === 9 ? objectValue(data[8]) : {};
      return {
        id,
        name: data[0],
        categoryId: data[1],
        type: data[2],
        target: data[3],
        ...extras,
        schedule: {
          kind: schedule[0],
          ...(schedule.length === 2 ? { weekdays: schedule[1] } : {}),
        },
        monthlyGoal: data[5],
        reminderTime: data[6],
        createdAt: data[7],
      };
    }
    case "habitMonths": {
      const data = arrayValue(value, 1);
      const separator = id.lastIndexOf("|");
      if (separator <= 0) throw new Error("invalid_record_storage");
      return {
        habitId: id.slice(0, separator),
        monthKey: id.slice(separator + 1),
        cells: expandHabitMonthCells(data[0]),
      };
    }
    case "tasks": {
      const data = arrayValue(value, 6, 7);
      return {
        id,
        dateKey: data[0],
        title: data[1],
        type: data[2],
        target: data[3],
        value: data[4],
        done: data[5],
        ...(data.length === 7 ? objectValue(data[6]) : {}),
      };
    }
    case "timerSessions": {
      const data = arrayValue(value, 4, 5);
      return {
        id,
        mode: data[0],
        focusSeconds: data[1],
        startedAt: data[2],
        endedAt: data[3],
        ...(data.length === 5 ? objectValue(data[4]) : {}),
      };
    }
    case "journal": {
      const data = arrayValue(value, 4);
      return { dateKey: id, text: data[0], score: data[1], mood: data[2], updatedAt: data[3] };
    }
  }
}
