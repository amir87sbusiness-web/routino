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
import { badRequest, unauthorized } from "../lib/http-errors.ts";
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
/** One public page of stored rows plus a lookahead is scanned server-side. The
 * returned prefix is additionally byte-bounded before crossing into Edge. */
export const PULL_DB_FETCH_ROW_LIMIT = PULL_PAGE_SIZE;
export const PULL_DB_FETCH_MAX_UTF8_BYTES = 256 * 1024;

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

function hasPgError(
  error: unknown,
  predicate: (candidate: {
    code?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
    message?: unknown;
  }) => boolean,
): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (predicate(candidate)) return true;
    current = candidate.cause;
  }
  return false;
}

/** Only absence of this release's exact function may enter the old-schema
 * compatibility writer. An unrelated PostgreSQL 42883 remains a server error. */
export function isUndefinedRoutinoPushRecordsError(error: unknown): boolean {
  return hasPgError(
    error,
    (candidate) =>
      candidate.code === "42883" &&
      typeof candidate.message === "string" &&
      /\broutino_push_records\s*\(/i.test(candidate.message),
  );
}

export function isLegacyAccountQuotaError(error: unknown): boolean {
  return hasPgError(error, (candidate) => {
    const constraint = candidate.constraint ?? candidate.constraint_name;
    return (
      candidate.code === "23514" &&
      (constraint === "users_sync_record_count_bounds" ||
        constraint === "users_sync_data_bytes_bounds")
    );
  });
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

type StampedPushRecord = PushRecord & { originalUpdatedAt: number };

/** Atomic writer for the schema immediately before annual quota/task archives.
 * `legacy_guard` refuses to write if annual columns already exist, preventing a
 * missing function on a migrated database from bypassing the annual allowance. */
async function pushRecordsLegacySchema(
  db: Database,
  userId: string,
  all: StampedPushRecord[],
  rejectedRecords: RejectedSyncRecord[],
): Promise<PushResult> {
  const values = all.map(
    (record, index) =>
      sql`(${record.kind}::text, ${record.id}::text, ${record.deleted ? null : JSON.stringify(record.data ?? null)}::jsonb, ${record.updatedAt}::bigint, ${record.deleted}::boolean, ${index}::bigint)`,
  );
  let result: Awaited<ReturnType<Database["execute"]>>;
  try {
    result = await db.execute(sql`
      with legacy_guard as (
        select 1 as ok
         where not exists (
           select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'users'
              and column_name in ('sync_growth_period_started_at', 'sync_growth_bytes')
         )
      ),
      incoming (kind, id, data, updated_at, deleted, ord) as (
        values ${sql.join(values, sql`, `)}
      ),
      cascaded (kind, id, data, updated_at, deleted, ord) as (
        select 'habitMonths'::text, child.id, null::jsonb,
               parent.updated_at, true,
               ${all.length}::bigint + row_number() over (order by child.id)
          from incoming parent
          join records child
            on child.user_id = ${userId}::uuid
           and child.kind = 'habitMonths'
           and child.deleted = false
           and child.id like parent.id || '|%'
         where parent.kind = 'habits' and parent.deleted = true
      ),
      combined as (
        select * from incoming
        union all
        select * from cascaded
      ),
      deduped as (
        select distinct on (kind, id)
               kind, id, data, updated_at, deleted, ord
          from combined
         order by kind, id, updated_at desc, deleted desc, ord
      ),
      numbered as (
        select kind, id, data, updated_at, deleted,
               row_number() over (order by ord, kind, id)::bigint as position
          from deduped
      ),
      sized as (
        select count(*)::bigint as total from numbered
      ),
      bump as (
        update users u set seq = u.seq + sized.total
          from sized cross join legacy_guard
         where u.id = ${userId}::uuid
        returning u.seq
      ),
      upserted as (
        insert into records (user_id, kind, id, data, updated_at, deleted, seq)
        select ${userId}::uuid, incoming.kind, incoming.id, incoming.data,
               incoming.updated_at, incoming.deleted,
               bump.seq - sized.total + incoming.position
          from numbered incoming cross join sized cross join bump
        on conflict (user_id, kind, id) do update
          set data = case
                when excluded.kind = 'habitMonths'
                 and excluded.deleted = false
                 and records.deleted = false
                then jsonb_build_object(
                  'habitId', excluded.data->'habitId',
                  'monthKey', excluded.data->'monthKey',
                  'cells', coalesce(records.data->'cells', '{}'::jsonb) || coalesce((
                    select jsonb_object_agg(incoming_cell.key, incoming_cell.value)
                      from jsonb_each(excluded.data->'cells') incoming_cell
                     where coalesce(
                       (records.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
                       -1
                     ) < (incoming_cell.value->>'updatedAt')::bigint
                  ), '{}'::jsonb)
                )
                else excluded.data
              end,
              updated_at = case
                when excluded.kind = 'habitMonths'
                 and excluded.deleted = false
                 and records.deleted = false
                then greatest(records.updated_at, excluded.updated_at)
                else excluded.updated_at
              end,
              deleted = case
                when excluded.kind = 'habitMonths'
                 and excluded.deleted = false
                 and records.deleted = false
                then false
                else excluded.deleted
              end,
              seq = excluded.seq
          where case
            when excluded.kind = 'habitMonths' then case
              when excluded.deleted = true or records.deleted = true
                then records.updated_at < excluded.updated_at
              else exists (
                select 1
                  from jsonb_each(excluded.data->'cells') incoming_cell
                 where coalesce(
                   (records.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
                   -1
                 ) < (incoming_cell.value->>'updatedAt')::bigint
              )
            end
            else records.updated_at < excluded.updated_at
          end
        returning 1 as ok
      )
      select (select seq from bump) as cursor,
             (select count(*) from upserted) as applied,
             (select total from sized) as total
    `);
  } catch (error) {
    if (!isLegacyAccountQuotaError(error)) throw error;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return {
      cursor: Number(user?.seq ?? 0),
      applied: 0,
      skipped: 0,
      rejectedRecords: [
        ...rejectedRecords,
        ...all.map((record) => ({
          kind: record.kind,
          id: record.id,
          updatedAt: record.originalUpdatedAt,
          code: "account_quota_exceeded" as const,
        })),
      ],
    };
  }

  const [row] = rowsOf<{
    cursor: string | number | null;
    applied: string | number;
    total: string | number;
  }>(result);
  if (!row || row.cursor === null) {
    throw new Error("legacy sync fallback refused migrated schema");
  }
  const applied = Number(row.applied);
  return {
    cursor: Number(row.cursor),
    applied,
    skipped: Number(row.total) - applied,
    rejectedRecords,
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
  const stamped: StampedPushRecord[] = valid.map((record) => ({
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
    if (isUndefinedRoutinoPushRecordsError(error)) {
      return pushRecordsLegacySchema(db, userId, all, rejectedRecords);
    }
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
  if (!row) throw unauthorized("unknown_user", "User no longer exists");
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
  metrics?: PullDbMetrics,
): Promise<PullResult> {
  const safeCursor = Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0;
  const safeLimit = Math.max(1, Math.min(PULL_PAGE_SIZE, Math.floor(limit) || PULL_PAGE_SIZE));
  const fetchLimit = Math.min(PULL_DB_FETCH_ROW_LIMIT, safeLimit);
  if (metrics) metrics.queries += 1;
  const result = await db.execute(sql`
    with owner as (
      select u.seq, u.gc_seq from users u where u.id = ${userId}::uuid
    ),
    fetched as (
      select r.kind, r.id, r.data, r.updated_at, r.deleted, r.seq,
             (
               octet_length(r.kind) + octet_length(r.id) +
               octet_length(coalesce(r.data::text, 'null')) + 64
             )::bigint as stored_bytes
        from records r cross join owner
       where r.user_id = ${userId}::uuid
         and r.seq > ${safeCursor}::bigint
         and (${safeCursor}::bigint = 0 or ${safeCursor}::bigint >= owner.gc_seq)
       order by r.seq
       limit ${fetchLimit + 1}
    ),
    measured as (
      select fetched.*,
             row_number() over (order by fetched.seq)::integer as row_no,
             sum(fetched.stored_bytes) over (order by fetched.seq)::bigint as running_bytes
        from fetched
    ),
    bounded as (
      select measured.*,
             (
               measured.row_no > ${fetchLimit} or
               (
                 measured.row_no > 1 and
                 measured.running_bytes > ${PULL_DB_FETCH_MAX_UTF8_BYTES}::bigint
               )
       ) as is_lookahead
        from measured
       where measured.row_no = 1
          or measured.running_bytes - measured.stored_bytes
               <= ${PULL_DB_FETCH_MAX_UTF8_BYTES}::bigint
    )
    select owner.seq as owner_seq, owner.gc_seq,
           bounded.kind, bounded.id, bounded.data, bounded.updated_at,
           bounded.deleted, bounded.seq, bounded.stored_bytes,
           bounded.is_lookahead
      from owner left join bounded on true
     order by bounded.row_no nulls last
  `);
  const rows = rowsOf<{
    owner_seq: string | number;
    gc_seq: string | number;
    kind: string | null;
    id: string | null;
    data: unknown;
    updated_at: string | number | null;
    deleted: boolean | null;
    seq: string | number | null;
    stored_bytes: string | number | null;
    is_lookahead: boolean | null;
  }>(result);
  const [ownerRow] = rows;
  if (!ownerRow) throw unauthorized("unknown_user", "User no longer exists");

  // A cursor at or below the GC watermark cannot be trusted to have seen the
  // tombstones that were purged below it. Cursor zero is a fresh device and is
  // exempt. The SQL above suppresses record fetches when a reset is required.
  const gcSeq = Number(ownerRow.gc_seq);
  if (safeCursor > 0 && safeCursor < gcSeq) {
    return { records: [], cursor: 0, hasMore: true, reset: true };
  }

  const transferred = rows.filter((row) => row.kind !== null);
  if (metrics) {
    const lookahead = transferred.filter((row) => Boolean(row.is_lookahead));
    const prefix = transferred.filter((row) => !row.is_lookahead);
    metrics.candidateRows += transferred.length;
    metrics.rawPrefixUtf8Bytes += prefix.reduce(
      (sum, row) => sum + Number(row.stored_bytes ?? 0),
      0,
    );
    metrics.lookaheadRows += lookahead.length;
    metrics.lookaheadUtf8Bytes += lookahead.reduce(
      (sum, row) => sum + Number(row.stored_bytes ?? 0),
      0,
    );
  }
  const hasLookahead = transferred.some((row) => Boolean(row.is_lookahead));
  const candidates = transferred
    .filter((row) => !row.is_lookahead)
    .map((row): PullRecord => ({
      kind: row.kind!,
      id: row.id!,
      data: row.data,
      updatedAt: Number(row.updated_at!),
      deleted: Boolean(row.deleted),
      seq: Number(row.seq!),
    }));
  const selected = selectPullPage(candidates, safeLimit, recordByteBudget, emptyPageMaxBytes);
  // `cursor` is non-zero whenever a stored row was selected, including a
  // valid empty archive. Preserve the caller's cursor only for an empty query.
  const nextCursor = selected.cursor || safeCursor;
  return {
    ...selected,
    cursor: nextCursor,
    hasMore: selected.hasMore || hasLookahead,
  };
}

export interface PullDbMetrics {
  /** Optional test instrumentation. It is never emitted in an HTTP response. */
  queries: number;
  candidateRows: number;
  rawPrefixUtf8Bytes: number;
  lookaheadRows: number;
  lookaheadUtf8Bytes: number;
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
