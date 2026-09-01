// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import { z } from "zod";
import { SYNC_KINDS, type SyncKind } from "../db/schema.ts";

export const MAX_JOURNAL_CHARACTERS = 4_000;
export const MAX_JOURNAL_UTF8_BYTES = 16 * 1024;
export const MAX_RECORD_UTF8_BYTES = 20 * 1024;
export const MAX_HABIT_MONTH_PACKET_UTF8_BYTES = 44 * 1024;

const ENTITY_ID_RE = /^[A-Za-z0-9_:.-]{1,128}$/;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const encoder = new TextEncoder();

const bounded = (max: number) => z.string().max(max);
const entityId = z.string().regex(ENTITY_ID_RE);
const epochMs = z.number().int().nonnegative().finite().max(Number.MAX_SAFE_INTEGER);
const finiteAmount = z.number().nonnegative().finite().max(1_000_000_000);
const note = bounded(4_000).optional();
const mood = bounded(32).optional();

function isDateKey(value: string): boolean {
  if (!DATE_KEY_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const dateKey = z.string().refine(isDateKey);

function isMonthKey(value: string): boolean {
  if (!MONTH_KEY_RE.test(value)) return false;
  const parsed = new Date(`${value}-01T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 7) === value;
}

const monthKey = z.string().refine(isMonthKey);

const categorySchema = z
  .object({
    id: entityId,
    nameFa: bounded(256),
    nameEn: bounded(256),
    color: bounded(32),
    icon: bounded(64),
    isDefault: z.boolean(),
    isLimit: z.boolean().optional(),
  })
  .strict();

const scheduleSchema = z
  .object({
    kind: z.enum(["daily", "odd", "even", "weekdays"]),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .refine((days) => new Set(days).size === days.length)
      .optional(),
  })
  .strict();

const habitSchema = z
  .object({
    id: entityId,
    name: z.string().min(1).max(256),
    categoryId: entityId,
    type: z.enum(["binary", "quantity"]),
    target: finiteAmount,
    unit: bounded(64).optional(),
    unitKind: z.enum(["count", "time"]).optional(),
    schedule: scheduleSchema,
    monthlyGoal: z.number().int().min(1).max(31).nullable(),
    reminderTime: z.string().regex(TIME_RE).nullable(),
    createdAt: epochMs,
    archived: z.boolean().optional(),
  })
  .strict();

const liveHabitMonthCellSchema = z
  .object({
    updatedAt: epochMs,
    deleted: z.literal(false),
    value: finiteAmount,
    done: z.boolean(),
    note,
    mood,
  })
  .strict();

const deletedHabitMonthCellSchema = z
  .object({
    updatedAt: epochMs,
    deleted: z.literal(true),
  })
  .strict();

const habitMonthCellSchema = z.discriminatedUnion("deleted", [
  liveHabitMonthCellSchema,
  deletedHabitMonthCellSchema,
]);

const habitMonthSchema = z
  .object({
    habitId: entityId,
    monthKey,
    cells: z.record(z.string(), habitMonthCellSchema),
  })
  .strict()
  .superRefine((month, ctx) => {
    const cells = Object.entries(month.cells);
    if (cells.length === 0 || cells.length > 31) {
      ctx.addIssue({ code: "custom", message: "habit month must contain 1..31 cells" });
    }
    for (const [day] of cells) {
      if (!/^\d{2}$/.test(day) || !isDateKey(`${month.monthKey}-${day}`)) {
        ctx.addIssue({ code: "custom", message: "cell date is outside month" });
      }
    }
  });

const taskSchema = z
  .object({
    id: entityId,
    dateKey,
    title: z.string().min(1).max(256),
    type: z.enum(["binary", "quantity"]),
    target: finiteAmount,
    value: finiteAmount,
    done: z.boolean(),
    note,
    unitKind: z.enum(["count", "time"]).optional(),
    reminderAt: bounded(64).nullable().optional(),
    color: bounded(32).optional(),
    icon: bounded(64).optional(),
  })
  .strict();

/** Canonical task payload contract, shared with server-only task archives. */
export function validateTaskPayload(id: string, data: unknown): boolean {
  const parsed = taskSchema.safeParse(data);
  return parsed.success && parsed.data.id === id;
}

const timerSessionSchema = z
  .object({
    id: entityId,
    mode: z.enum(["pomodoro", "free", "stopwatch"]),
    focusSeconds: z
      .number()
      .int()
      .nonnegative()
      .finite()
      .max(10 * 365 * 86_400),
    startedAt: epochMs,
    endedAt: epochMs,
    linkedKind: z.enum(["habit", "task"]).optional(),
    linkedId: entityId.optional(),
    linkedLabel: bounded(256).optional(),
  })
  .strict()
  .refine((session) => session.endedAt >= session.startedAt);

const journalSchema = z
  .object({
    dateKey,
    text: bounded(MAX_JOURNAL_CHARACTERS),
    score: z.number().int().min(1).max(10).nullable(),
    mood: bounded(32).nullable(),
    updatedAt: epochMs,
  })
  .strict();

const schemas: Record<SyncKind, z.ZodType> = {
  categories: categorySchema,
  habits: habitSchema,
  habitMonths: habitMonthSchema,
  tasks: taskSchema,
  timerSessions: timerSessionSchema,
  journal: journalSchema,
};

export interface PushRecord {
  kind: string;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
}

export type SyncRejectionCode =
  | "bad_kind"
  | "bad_id"
  | "bad_updated_at"
  | "invalid_record"
  | "record_too_large"
  | "account_quota_exceeded";

export type RecordValidation =
  { ok: true; record: PushRecord } | { ok: false; code: SyncRejectionCode };

export interface RejectedSyncRecord {
  kind: string;
  id: string;
  updatedAt: number;
  code: SyncRejectionCode;
  /** Present for annual account quota refusals so the durable client outbox can
   * pause this exact version instead of retrying it on every app lifecycle. */
  retryAt?: number;
}

const isSyncKind = (kind: string): kind is SyncKind =>
  (SYNC_KINDS as readonly string[]).includes(kind);

function hasValidId(kind: SyncKind, id: string): boolean {
  if (kind === "journal") return isDateKey(id);
  if (kind === "habitMonths") {
    const separator = id.lastIndexOf("|");
    if (separator <= 0) return false;
    return ENTITY_ID_RE.test(id.slice(0, separator)) && isMonthKey(id.slice(separator + 1));
  }
  return ENTITY_ID_RE.test(id);
}

function encodedJsonBytes(value: unknown): number | null {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return null;
  }
}

function payloadMatchesId(
  kind: SyncKind,
  id: string,
  data: unknown,
  envelopeUpdatedAt: number,
): boolean {
  const item = data as Record<string, unknown>;
  if (kind === "journal") return item.dateKey === id;
  if (kind === "habitMonths") {
    const cells = Object.values(item.cells as Record<string, { updatedAt: number }>);
    return (
      `${item.habitId}|${item.monthKey}` === id &&
      Math.max(...cells.map((cell) => cell.updatedAt)) === envelopeUpdatedAt
    );
  }
  return item.id === id;
}

export function validateSyncRecord(record: PushRecord): RecordValidation {
  if (!isSyncKind(record.kind)) return { ok: false, code: "bad_kind" };
  if (!hasValidId(record.kind, record.id)) return { ok: false, code: "bad_id" };
  if (
    !Number.isFinite(record.updatedAt) ||
    !Number.isInteger(record.updatedAt) ||
    record.updatedAt < 0 ||
    record.updatedAt > Number.MAX_SAFE_INTEGER
  ) {
    return { ok: false, code: "bad_updated_at" };
  }

  if (record.deleted) return { ok: true, record };

  if (record.kind === "journal") {
    const candidate = record.data as { text?: unknown } | null;
    if (typeof candidate?.text === "string") {
      if (candidate.text.length > MAX_JOURNAL_CHARACTERS) {
        return { ok: false, code: "record_too_large" };
      }
      if (encoder.encode(candidate.text).byteLength > MAX_JOURNAL_UTF8_BYTES) {
        return { ok: false, code: "record_too_large" };
      }
    }
  }

  const parsed = schemas[record.kind].safeParse(record.data);
  if (
    !parsed.success ||
    !payloadMatchesId(record.kind, record.id, parsed.data, record.updatedAt)
  ) {
    return { ok: false, code: "invalid_record" };
  }

  const bytes = encodedJsonBytes(record.data);
  if (bytes === null) return { ok: false, code: "invalid_record" };
  const maxBytes =
    record.kind === "habitMonths" ? MAX_HABIT_MONTH_PACKET_UTF8_BYTES : MAX_RECORD_UTF8_BYTES;
  if (bytes > maxBytes) return { ok: false, code: "record_too_large" };

  return { ok: true, record };
}
