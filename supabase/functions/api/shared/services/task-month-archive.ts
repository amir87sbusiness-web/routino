// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import { validateTaskPayload } from "./sync-record-validation.ts";

export const TASK_MONTH_ARCHIVE_KIND = "taskMonths" as const;
export const TASK_MONTH_ARCHIVE_VERSION = 1 as const;

export interface TaskMonthArchiveV1 {
  v: 1;
  monthKey: string;
  count: number;
  checksum: string;
  items: [id: string, updatedAt: number, data: unknown][];
}

export interface StoredTaskMonthRecord {
  kind: "taskMonths";
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
  seq: number;
}

export interface ArchivedTaskPullRecord {
  kind: "tasks";
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: false;
  seq: number;
}

export function isTaskMonthArchiveKind(kind: string): kind is "taskMonths" {
  return kind === TASK_MONTH_ARCHIVE_KIND;
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const CHECKSUM_RE = /^[a-f0-9]{32}$/;

function isMonthKey(value: string): boolean {
  if (!MONTH_KEY_RE.test(value)) return false;
  const parsed = new Date(`${value}-01T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 7) === value;
}

function isArchiveData(value: unknown): value is TaskMonthArchiveV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    data.v === TASK_MONTH_ARCHIVE_VERSION &&
    typeof data.monthKey === "string" &&
    typeof data.count === "number" &&
    typeof data.checksum === "string" &&
    Array.isArray(data.items)
  );
}

function invalidArchive(): never {
  throw new Error("invalid_task_month_archive");
}

export function expandTaskMonthArchive(
  record: StoredTaskMonthRecord,
): ArchivedTaskPullRecord[] {
  if (!isArchiveData(record.data)) {
    const data = record.data as { v?: unknown } | null;
    if (data?.v !== TASK_MONTH_ARCHIVE_VERSION) {
      throw new Error("unsupported_task_archive_version");
    }
    return invalidArchive();
  }

  const archive = record.data;
  if (
    !isMonthKey(archive.monthKey) ||
    !record.id.startsWith(`${archive.monthKey}|`) ||
    !Number.isSafeInteger(archive.count) ||
    archive.count < 0 ||
    archive.count !== archive.items.length ||
    !CHECKSUM_RE.test(archive.checksum)
  ) {
    return invalidArchive();
  }

  const ids = new Set<string>();
  const expanded: ArchivedTaskPullRecord[] = [];
  for (const item of archive.items) {
    if (!Array.isArray(item) || item.length !== 3) return invalidArchive();
    const [id, updatedAt, data] = item;
    if (
      typeof id !== "string" ||
      !Number.isSafeInteger(updatedAt) ||
      updatedAt < 0 ||
      ids.has(id) ||
      !validateTaskPayload(id, data) ||
      (data as { dateKey: string }).dateKey.slice(0, 7) !== archive.monthKey
    ) {
      return invalidArchive();
    }
    ids.add(id);
    expanded.push({ kind: "tasks", id, data, updatedAt, deleted: false, seq: record.seq });
  }

  return expanded;
}
