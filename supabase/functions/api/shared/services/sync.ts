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
import { and, eq, gt, like, sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.ts";
import { records, users } from "../db/schema.ts";
import { badRequest } from "../lib/http-errors.ts";
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

/**
 * Month ids belonging to a habit, so deleting the habit can bury its history.
 *
 * The client sends ONE habit tombstone rather than one per month. Month ids are
 * `habitId|YYYY-MM`, so the prefix match is exact rather than heuristic.
 */
async function childMonthIds(db: Database, userId: string, habitId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(records)
    .where(
      and(
        eq(records.userId, userId),
        eq(records.kind, "habitMonths"),
        eq(records.deleted, false),
        // `habitId` came through ID_RE, so it holds no LIKE wildcards.
        like(records.id, `${habitId}|%`),
      ),
    );
  return rows.map((r) => r.id);
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

  // Expand habit deletes into month tombstones before the write, so the sequence
  // block below is sized to everything actually written.
  const cascaded: PushRecord[] = [];
  for (const r of stamped) {
    if (r.kind !== "habits" || !r.deleted) continue;
    for (const id of await childMonthIds(db, userId, r.id)) {
      cascaded.push({ kind: "habitMonths", id, data: null, updatedAt: r.updatedAt, deleted: true });
    }
  }

  const all = dedupe([...stamped, ...cascaded]);

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
  const res = await db.execute(sql`
    with bump as (
      update users set seq = seq + ${all.length} where id = ${userId} returning seq
    ),
    incoming (kind, id, data, updated_at, deleted, ord) as (
      values ${sql.join(values, sql`, `)}
    ),
    upserted as (
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      select ${userId}::uuid, i.kind, i.id, i.data, i.updated_at, i.deleted,
             b.seq - ${all.length} + 1 + i.ord
        from incoming i cross join bump b
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
    select (select seq from bump) as cursor, (select count(*) from upserted) as applied
  `);

  const [row] = rowsOf<{ cursor: string | number; applied: string | number }>(res);
  if (!row) throw new Error("sync push produced no result row");
  // bigint and count() arrive as strings on node-postgres, numbers on PGlite.
  const applied = Number(row.applied);
  return {
    cursor: Number(row.cursor),
    applied,
    skipped: all.length - applied,
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

  const page = await db
    .select()
    .from(records)
    .where(and(eq(records.userId, userId), gt(records.seq, safeCursor)))
    .orderBy(records.seq)
    // One extra row is the cheapest way to answer "is there another page?"
    // without a second COUNT over the same index.
    .limit(limit + 1);

  const hasMore = page.length > limit;
  const rows = hasMore ? page.slice(0, limit) : page;

  return {
    records: rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      data: r.data,
      updatedAt: Number(r.updatedAt),
      deleted: r.deleted,
      seq: Number(r.seq),
    })),
    cursor: rows.length ? Number(rows[rows.length - 1]!.seq) : safeCursor,
    hasMore,
    reset: false,
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
