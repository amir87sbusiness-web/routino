// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * Delta sync — the server half of "the same data on every device".
 *
 * The protocol is a per-user change log. Every write to `records` is stamped
 * with a number from `users.seq`, and a device remembers the highest number it
 * has seen. Pulling is then "give me everything above my cursor", which is one
 * index scan and carries no clocks, no vector versions and no merge on the
 * server.
 *
 * Two invariants do all the work, and both are easy to break by accident:
 *
 *  1. **Seq order must match commit order.** `users.seq` is bumped with
 *     `UPDATE … SET seq = seq + n RETURNING seq`, which takes a row lock and so
 *     serialises this user's pushes. A plain SEQUENCE cannot do this: a slower
 *     transaction can take a LOWER number and commit AFTER a reader has already
 *     advanced past it, and that row is then invisible to that device forever.
 *
 *  2. **`updated_at` decides conflicts, and it is a CLIENT clock.** It is
 *     clamped to `min(client, now + 60s)` on the way in. Unclamped, one device
 *     with its clock set to 2099 wins every conflict on the account forever and
 *     no amount of correct client code recovers it.
 *
 * Deletes are rows, never absences: a tombstone has to be able to travel.
 */
import { eq, sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { badRequest } from "../lib/http-errors.ts";
import {
  expandTaskMonthArchive,
  isTaskMonthArchiveKind,
  type StoredTaskMonthRecord,
} from "./task-month-archive.ts";
import {
  validateSyncRecord,
  type PushRecord,
  type RejectedSyncRecord,
} from "./sync-record-validation.ts";

export type { PushRecord, RejectedSyncRecord } from "./sync-record-validation.ts";

/** How far ahead of the server a device's clock may be before we stop believing
 * it. Generous enough for ordinary skew, small enough that a wrong clock cannot
 * park a record permanently at the top of every conflict. */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/** Rows per push. The Fastify app caps bodies at 64 KB, so the client chunks;
 * this is the server refusing to be told otherwise. */
export const MAX_PUSH_RECORDS = 200;

/** Rows per pull page. A first sync of a year of history is thousands of rows,
 * so pulling is paged and the client loops until `hasMore` is false. */
export const PULL_PAGE_SIZE = 500;
/** Hard cap for one pull/exchange JSON response. The query keeps an 8 KiB
 * envelope reserve for cursor/reset/entitlement metadata. */
export const PULL_RESPONSE_MAX_UTF8_BYTES = 512 * 1024;
const PULL_RECORDS_BYTE_BUDGET = PULL_RESPONSE_MAX_UTF8_BYTES - 8 * 1024;

const SYNC_QUOTA_CONSTRAINTS = new Set([
  "users_sync_record_count_bounds",
  "users_sync_growth_bytes_bounds",
]);

/** Drizzle preserves the native Postgres error either directly or as `cause`,
 * depending on the driver. Match only SQLSTATE 23514 plus our named checks: an
 * unrelated database failure must remain loud instead of being mislabeled as a
 * harmless quota refusal. */
export function isAccountQuotaError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    const constraint = candidate.constraint ?? candidate.constraint_name;
    if (
      candidate.code === "23514" &&
      typeof constraint === "string" &&
      SYNC_QUOTA_CONSTRAINTS.has(constraint)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export interface PullRecord {
  kind: string;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
  seq: number;
}

export interface PushResult {
  /** The device's new cursor: every row this push wrote is at or below it. */
  cursor: number;
  applied: number;
  /** Rows rejected by last-write-wins because the server already held a newer
   * copy. Not an error — the client drops its dirty flag either way, since the
   * newer value arrives on the next pull. */
  skipped: number;
  /** Invalid rows refused independently so one bad local item cannot stop the
   * rest of the outbox or the pull. Payload data is never echoed. */
  rejectedRecords: RejectedSyncRecord[];
}

export interface PullResult {
  records: PullRecord[];
  cursor: number;
  hasMore: boolean;
  /**
   * True when the device's cursor sits below the tombstone GC watermark, so it
   * may have missed a delete that has since been purged. Continuing from there
   * would silently RESURRECT deleted records, so the client must wipe and pull
   * from zero instead.
   */
  reset: boolean;
}

export interface ExchangeResult extends PullResult {
  applied: number;
  skipped: number;
  rejectedRecords: RejectedSyncRecord[];
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** Converts a server-only archive row into the ordinary task rows understood by
 * every released client. Stored archives never cross the HTTP boundary raw. */
export function expandStoredPullRecord(record: PullRecord): PullRecord[] {
  return isTaskMonthArchiveKind(record.kind)
    ? expandTaskMonthArchive(record as StoredTaskMonthRecord)
    : [record];
}

/**
 * Chooses complete stored rows for one public pull page. A task archive has one
 * database sequence number but many client-visible tasks, so it must be either
 * included in full or left for the next request; advancing past part of one
 * would make the omitted tasks permanently unreachable.
 */
export function selectPullPage(
  candidates: PullRecord[],
  safeLimit: number,
  byteBudget: number,
  emptyPageMaxBytes = byteBudget,
): PullResult {
  const records: PullRecord[] = [];
  let cursor = 0;
  let usedBytes = 0;
  let selectedStoredRows = 0;

  for (const stored of candidates) {
    const expanded = expandStoredPullRecord(stored);
    const nextBytes = utf8Bytes(JSON.stringify(expanded)) + 1;
    if (
      selectedStoredRows > 0 &&
      (records.length + expanded.length > safeLimit || usedBytes + nextBytes > byteBudget)
    ) {
      break;
    }
    if (nextBytes > byteBudget) {
      // Exchange metadata can temporarily leave less room than this otherwise
      // valid stored row needs. Return an empty page only when the same row
      // fits the normal pull budget; a permanently oversized archive must
      // remain fail-closed instead of producing an endless empty-page loop.
      if (
        selectedStoredRows === 0 &&
        byteBudget < emptyPageMaxBytes &&
        nextBytes <= emptyPageMaxBytes
      ) {
        break;
      }
      throw new Error("task_archive_chunk_exceeds_pull_budget");
    }
    records.push(...expanded);
    usedBytes += nextBytes;
    selectedStoredRows += 1;
    cursor = stored.seq;
  }

  return {
    records,
    cursor,
    hasMore: selectedStoredRows < candidates.length,
    reset: false,
  };
}

function partitionIncoming(rows: PushRecord[]): {
  valid: PushRecord[];
  rejectedRecords: RejectedSyncRecord[];
} {
  if (rows.length > MAX_PUSH_RECORDS) {
    throw badRequest("too_many_records", `Send at most ${MAX_PUSH_RECORDS} records per push`);
  }
  const valid: PushRecord[] = [];
  const rejectedRecords: RejectedSyncRecord[] = [];
  for (const r of rows) {
    const result = validateSyncRecord(r);
    if (result.ok) valid.push(result.record);
    else {
      rejectedRecords.push({
        kind: r.kind,
        id: r.id,
        updatedAt: r.updatedAt,
        code: result.code,
      });
    }
  }
  return { valid, rejectedRecords };
}

const keyOf = (r: PushRecord) => `${r.kind} ${r.id}`;

/**
 * Collapses repeats of the same `(kind, id)` by the same LWW rule used in DB.
 *
 * Not a nicety: `INSERT … ON CONFLICT DO UPDATE` raises 21000 ("cannot affect
 * row a second time") if one statement touches a key twice. That would be a 500
 * on a push the client retries forever with identical content — sync wedged for
 * that account, permanently. Newer wins; on an exact tie a tombstone wins so a
 * pending cell cannot keep a month alive beside a habit deleted in the same tick.
 */
function dedupe<T extends PushRecord>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const r of rows) {
    const existing = byKey.get(keyOf(r));
    if (
      !existing ||
      r.updatedAt > existing.updatedAt ||
      (r.updatedAt === existing.updatedAt && r.deleted && !existing.deleted)
    ) {
      byKey.set(keyOf(r), r);
    }
  }
  return [...byKey.values()];
}

function clampRecordClock(record: PushRecord, ceiling: number): PushRecord {
  if (record.kind !== "habitMonths" || record.deleted) {
    return { ...record, updatedAt: Math.min(record.updatedAt, ceiling) };
  }
  const month = record.data as {
    habitId: string;
    monthKey: string;
    cells: Record<string, { data: unknown; updatedAt: number; deleted: boolean }>;
  };
  const cells = Object.fromEntries(
    Object.entries(month.cells).map(([dateKey, cell]) => [
      dateKey,
      { ...cell, updatedAt: Math.min(cell.updatedAt, ceiling) },
    ]),
  );
  return {
    ...record,
    data: { ...month, cells },
    updatedAt: Math.max(...Object.values(cells).map((cell) => cell.updatedAt)),
  };
}

export async function pushRecords(
  db: Database,
  userId: string,
  incoming: PushRecord[],
  now: Date,
): Promise<PushResult> {
  const { valid, rejectedRecords } = partitionIncoming(incoming);

  if (valid.length === 0) {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return { cursor: Number(u?.seq ?? 0), applied: 0, skipped: 0, rejectedRecords };
  }

  const ceiling = now.getTime() + CLOCK_SKEW_TOLERANCE_MS;
  const stamped = valid.map((record) => ({
    ...clampRecordClock(record, ceiling),
    // Quota backoff identifies the exact durable local version. The stored
    // timestamp is clamped for LWW safety, but rejections must echo this one.
    originalUpdatedAt: record.updatedAt,
  }));

  // Incoming work is capped at 200, so this bounded JS dedupe is safe. Habit
  // month cascades are intentionally NOT materialised here: one long-lived
  // habit can own thousands of rows, and production Edge memory must not scale
  // with account history.
  const all = dedupe(stamped);
  const packet = all.map((record) => ({
    kind: record.kind,
    id: record.id,
    data: record.deleted ? null : (record.data ?? null),
    updatedAt: record.updatedAt,
    originalUpdatedAt: record.originalUpdatedAt,
    deleted: record.deleted,
  }));

  // One database round trip. The volatile PL/pgSQL function first locks the
  // owner row, then performs its record read/write as a later command with a
  // fresh READ COMMITTED snapshot. Keeping those as two server-side commands is
  // essential: a single CTE statement keeps its original snapshot even after
  // waiting for the user lock and can otherwise overwrite a newer concurrent
  // record. The function holds the lock until this transaction finishes.
  let res: Awaited<ReturnType<Database["execute"]>>;
  try {
    res = await db.execute(sql`
      select result.cursor, result.applied, result.skipped, result.quota_rejected
        from routino_push_records(
          ${userId}::uuid,
          ${now.toISOString()}::timestamptz,
          ${JSON.stringify(packet)}::jsonb
        ) result
    `);
  } catch (error) {
    if (!isAccountQuotaError(error)) throw error;
    // The single write statement has already rolled back both its seq bump and
    // every record. Return bounded metadata only; private payloads never echo.
    const quotaState = await db.execute(sql`
      select seq,
             floor(extract(epoch from (
               sync_growth_period_started_at + interval '365 days'
             )) * 1000)::bigint as retry_at
        from users where id = ${userId}::uuid
    `);
    const [u] = rowsOf<{ seq: string | number; retry_at: string | number }>(quotaState);
    const retryAt = Number(u?.retry_at);
    return {
      cursor: Number(u?.seq ?? 0),
      applied: 0,
      skipped: 0,
      rejectedRecords: [
        ...rejectedRecords,
        ...valid.map((record) => ({
          kind: record.kind,
          id: record.id,
          updatedAt: record.updatedAt,
          code: "account_quota_exceeded" as const,
          ...(Number.isFinite(retryAt) ? { retryAt } : {}),
        })),
      ],
    };
  }

  const [row] = rowsOf<{
    cursor: string | number;
    applied: string | number;
    skipped: string | number;
    quota_rejected: RejectedSyncRecord[];
  }>(res);
  if (!row) throw new Error("sync push produced no result row");
  // bigint and count() arrive as strings on node-postgres, numbers on PGlite.
  const applied = Number(row.applied);
  return {
    cursor: Number(row.cursor),
    applied,
    skipped: Number(row.skipped),
    rejectedRecords: [
      ...rejectedRecords,
      ...(Array.isArray(row.quota_rejected)
        ? row.quota_rejected.map((rejection) => ({
            ...rejection,
            retryAt: Number(rejection.retryAt),
          }))
        : []),
    ],
  };
}

export async function pullRecords(
  db: Database,
  userId: string,
  cursor: number,
  limit = PULL_PAGE_SIZE,
  recordByteBudget = PULL_RECORDS_BYTE_BUDGET,
  emptyPageMaxBytes = recordByteBudget,
): Promise<PullResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw badRequest("unknown_user", "No such user");

  const gcSeq = Number(user.gcSeq);
  const safeCursor = Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0;

  // A cursor at or below the GC watermark cannot be trusted to have seen the
  // tombstones that were purged below it. `0` is exempt: a device that has never
  // synced has nothing to resurrect, and treating a first sync as a "reset"
  // would send every new install through the wipe path for no reason.
  if (safeCursor > 0 && safeCursor < gcSeq) {
    return { records: [], cursor: 0, hasMore: true, reset: true };
  }

  const safeLimit = Math.max(1, Math.min(PULL_PAGE_SIZE, Math.floor(limit) || PULL_PAGE_SIZE));
  const result = await db.execute(sql`
    select r.kind, r.id, r.data, r.updated_at, r.deleted, r.seq
      from records r
     where r.user_id = ${userId}::uuid and r.seq > ${safeCursor}::bigint
     order by r.seq
     limit ${safeLimit}
  `);
  const rows = rowsOf<{
    kind: string;
    id: string;
    data: unknown;
    updated_at: string | number;
    deleted: boolean;
    seq: string | number;
  }>(result);
  const candidates = rows.map(
    (r): PullRecord => ({
      kind: r.kind,
      id: r.id,
      data: r.data,
      updatedAt: Number(r.updated_at),
      deleted: r.deleted,
      seq: Number(r.seq),
    }),
  );
  const selected = selectPullPage(candidates, safeLimit, recordByteBudget, emptyPageMaxBytes);
  // `cursor` is non-zero whenever a stored row was selected, including a
  // valid empty archive. Preserve the caller's cursor only for an empty query.
  const nextCursor = selected.cursor || safeCursor;
  const later = await db.execute(sql`
    select exists (
      select 1 from records
       where user_id = ${userId}::uuid and seq > ${nextCursor}::bigint
    ) as has_more
  `);
  const [laterRow] = rowsOf<{ has_more: boolean }>(later);

  return {
    ...selected,
    cursor: nextCursor,
    hasMore: selected.hasMore || Boolean(laterRow?.has_more),
  };
}

/** Applies this device's outbox and reads changes from its ORIGINAL cursor.
 * Keeping the original cursor is essential: adopting the push cursor would
 * skip rows another device committed before this request. Empty exchanges skip
 * the push query entirely. */
export async function exchangeRecords(
  db: Database,
  userId: string,
  cursor: number,
  incoming: PushRecord[],
  now: Date,
  limit = PULL_PAGE_SIZE,
): Promise<ExchangeResult> {
  const pushed = incoming.length
    ? await pushRecords(db, userId, incoming, now)
    : { applied: 0, skipped: 0, rejectedRecords: [] };
  // `pullRecords` reserves 8 KiB for its normal response envelope. Exchange
  // adds client-controlled (but bounded) rejection metadata, so reserve its
  // actual UTF-8 JSON size too before choosing public records.
  const rejectedBytes = utf8Bytes(JSON.stringify(pushed.rejectedRecords));
  const exchangeRecordBudget = pushed.rejectedRecords.length
    ? Math.max(0, PULL_RECORDS_BYTE_BUDGET - rejectedBytes)
    : PULL_RECORDS_BYTE_BUDGET;
  const pulled = await pullRecords(
    db,
    userId,
    cursor,
    limit,
    exchangeRecordBudget,
    PULL_RECORDS_BYTE_BUDGET,
  );
  return {
    ...pulled,
    applied: pushed.applied,
    skipped: pushed.skipped,
    rejectedRecords: pushed.rejectedRecords,
  };
}

/**
 * Drops tombstones older than `keepMs` and raises the GC watermark.
 *
 * Tombstones cannot be kept forever — a user who deletes a habit a week keeps
 * paying for those rows in every pull. Raising `gc_seq` to the highest purged
 * seq is what makes the deletion safe: any device still below that line is told
 * to full-resync rather than being allowed to miss a delete and resurrect it.
 *
 * Supabase schedules the equivalent single-statement purge in generated
 * `supabase/setup.sql`; this function remains the directly testable service form.
 */
export async function purgeTombstones(
  db: Database,
  userId: string,
  now: Date,
  keepMs = 90 * 86_400_000,
): Promise<number> {
  const cutoff = now.getTime() - keepMs;

  // One statement, and the delete is deliberately keyed on nothing but its own
  // WHERE clause.
  //
  // The previous version read every tombstone the user had ever made into
  // memory, filtered in JS, then deleted `WHERE id IN (…)` — without `kind`.
  // Ids are only unique WITHIN a kind (a journal entry is keyed by date, a
  // settings row by field name), so that could delete a tombstone of a DIFFERENT
  // kind that sits ABOVE the new watermark. No device is ever told about that
  // delete, so the record comes back from the dead on the next sync.
  //
  // Raising `gc_seq` to the highest seq actually removed is what makes the purge
  // safe: a device still below that line is told to full-resync instead of being
  // allowed to miss a delete.
  const res = await db.execute(sql`
    with doomed as (
      delete from records
       where user_id = ${userId}::uuid
         and deleted = true
         and updated_at < ${cutoff}
      returning seq
    ),
    bump as (
      update users
         set gc_seq = greatest(gc_seq, coalesce((select max(seq) from doomed), gc_seq))
       where id = ${userId}::uuid
    )
    select count(*) as n from doomed
  `);

  const [row] = rowsOf<{ n: string | number }>(res);
  return Number(row?.n ?? 0);
}
