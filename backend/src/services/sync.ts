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
import { rowsOf, type Database } from "../db/client.js";
import { users } from "../db/schema.js";
import { badRequest } from "../lib/http-errors.js";
import {
  expandTaskMonthArchive,
  isTaskMonthArchiveKind,
  type StoredTaskMonthRecord,
} from "./task-month-archive.js";
import {
  validateSyncRecord,
  type PushRecord,
  type RejectedSyncRecord,
} from "./sync-record-validation.js";

export type { PushRecord, RejectedSyncRecord } from "./sync-record-validation.js";

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
  "users_sync_data_bytes_bounds",
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
    if (nextBytes > byteBudget) throw new Error("task_archive_chunk_exceeds_pull_budget");
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
function dedupe(rows: PushRecord[]): PushRecord[] {
  const byKey = new Map<string, PushRecord>();
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
  const stamped = valid.map((record) => clampRecordClock(record, ceiling));

  // Incoming work is capped at 200, so this bounded JS dedupe is safe. Habit
  // month cascades are intentionally NOT materialised here: one long-lived
  // habit can own thousands of rows, and production Edge memory must not scale
  // with account history.
  const all = dedupe(stamped);

  const values = all.map(
    (r, i) =>
      sql`(${r.kind}::text, ${r.id}::text, ${r.deleted ? null : JSON.stringify(r.data ?? null)}::jsonb, ${r.updatedAt}::bigint, ${r.deleted}::boolean, ${i}::bigint)`,
  );

  // ONE statement, and that is the whole point of the shape below.
  //
  // `bump` takes the row lock on `users`, and because the insert reads `bump`
  // in the SAME statement, that lock is still held when the record rows commit.
  // That is what actually makes seq order match commit order (invariant 1).
  // Split across two statements — reserve, then insert — the lock is released
  // at the first semicolon, so a push holding a LOWER block can commit AFTER a
  // reader has already advanced past it, and those rows are then invisible to
  // that device forever. A regression test covers exactly this.
  //
  // Last-write-wins lives in the WHERE of the DO UPDATE: an older copy simply
  // does not land. Equal timestamps also lose, which keeps a device replaying
  // its outbox from churning `seq` — and therefore from waking every other
  // device up for a row that did not change.
  let res: Awaited<ReturnType<Database["execute"]>>;
  try {
    res = await db.execute(sql`
      with incoming (kind, id, data, updated_at, deleted, ord) as (
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
          from sized where u.id = ${userId} returning u.seq
      ),
      upserted as (
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      select ${userId}::uuid, i.kind, i.id, i.data, i.updated_at, i.deleted,
             b.seq - s.total + i.position
        from numbered i cross join sized s cross join bump b
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
    if (!isAccountQuotaError(error)) throw error;
    // The single write statement has already rolled back both its seq bump and
    // every record. Return bounded metadata only; private payloads never echo.
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
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
        })),
      ],
    };
  }

  const [row] = rowsOf<{
    cursor: string | number;
    applied: string | number;
    total: string | number;
  }>(res);
  if (!row) throw new Error("sync push produced no result row");
  // bigint and count() arrive as strings on node-postgres, numbers on PGlite.
  const applied = Number(row.applied);
  return {
    cursor: Number(row.cursor),
    applied,
    skipped: Number(row.total) - applied,
    rejectedRecords,
  };
}

export async function pullRecords(
  db: Database,
  userId: string,
  cursor: number,
  limit = PULL_PAGE_SIZE,
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
  const selected = selectPullPage(candidates, safeLimit, PULL_RECORDS_BYTE_BUDGET);
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
  const pulled = await pullRecords(db, userId, cursor, limit);
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
