/**
 * Conflict resolution, as a pure function.
 *
 * Separated from the engine because this is the part that can silently destroy
 * a user's data, and a pure function is the only version of it that can be
 * exhaustively tested without a database, a server, or a clock.
 *
 * The rule is last-write-wins on `updatedAt`, which the server has already
 * clamped to `min(client, serverNow + 60s)` — so a device with a broken clock
 * cannot park a record at the top of every comparison here.
 */
import type { RecordRow, SyncedTable } from "../db/dexie";
import type { RemoteRecord } from "../api/sync";

/** Server-side kinds, mirrored from `SYNC_KINDS` in backend/src/db/schema.ts.
 *
 * `feedback` is deliberately absent even though it IS a local table: it is
 * push-only to its own endpoint and the server rejects it as an unknown kind.
 * Including it here would make every push 400 and sync would never run at all. */
export const SYNCABLE_TABLES = [
  "categories",
  "habits",
  "logs",
  "tasks",
  "timerSessions",
  "journal",
] as const satisfies readonly SyncedTable[];

export type SyncableTable = (typeof SYNCABLE_TABLES)[number];

const isSyncable = (t: string): t is SyncableTable =>
  (SYNCABLE_TABLES as readonly string[]).includes(t);

/**
 * True when a remote record may be accepted at all.
 *
 * Settings are absent from the allow-list, so stale or hostile legacy rows are
 * ignored at the boundary instead of being written to any local table.
 */
export function acceptsRemote(record: RemoteRecord): boolean {
  if (!isSyncable(record.kind)) return false;
  return true;
}

/**
 * The row to write for an incoming remote record, or `null` to keep the local one.
 *
 * `dirty: 0` on everything returned: an applied remote record is by definition
 * already on the server, and marking it dirty would push it straight back and
 * bump its `seq`, waking every other device for a change that did not happen.
 *
 * A surviving local row keeps its `seq`, because that is presentation order
 * (`src/lib/db/dexie.ts`) and re-assigning it would reshuffle the user's lists
 * every time they synced.
 */
export function mergeRemote(
  local: RecordRow<unknown> | undefined,
  remote: RemoteRecord,
  allocSeq: () => number,
): RecordRow<unknown> | null {
  if (!acceptsRemote(remote)) return null;

  // Equal timestamps are stable except for delete-vs-live: a tombstone wins
  // that tie so archive expansion plus an ordinary override cannot resurrect
  // content based on pagination. Equal tombstones remain untouched (no churn).
  if (
    local &&
    (local.updatedAt > remote.updatedAt ||
      (local.updatedAt === remote.updatedAt && !(remote.deleted && !local.deleted)))
  ) {
    return null;
  }

  return {
    key: remote.id,
    data: remote.deleted ? null : remote.data,
    updatedAt: remote.updatedAt,
    deleted: remote.deleted ? 1 : 0,
    dirty: 0,
    seq: local?.seq ?? allocSeq(),
  };
}
