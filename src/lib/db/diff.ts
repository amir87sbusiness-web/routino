/**
 * Reference-equality diff: in-memory `Db` -> the minimal set of record writes.
 *
 * Every write path in the app builds its next state with `.map()`/`.filter()`/
 * spread, all of which preserve the references of untouched elements. So a
 * pointer comparison identifies changed records in O(n) with no deep equality —
 * `prev.get(id) !== item` is the entire test.
 *
 * This is pure and total. It is the single most correctness-critical function in
 * the storage layer, because anything it fails to report is a write that silently
 * never lands.
 */
import type { Db } from "../store";
import { SYNCED_SETTING_KEYS } from "./local";
import type { SyncedTable } from "./dexie";

export interface Change {
  table: SyncedTable;
  key: string;
  /** Absent when `deleted` — a tombstone carries no body. */
  data?: unknown;
  deleted: boolean;
}

function diffById<T extends { id: string }>(
  table: SyncedTable,
  prev: readonly T[] | undefined,
  next: readonly T[],
  out: Change[],
): void {
  if (prev === next) return; // whole collection untouched — the common case
  const prevById = new Map((prev ?? []).map((x) => [x.id, x]));
  for (const item of next) {
    if (prevById.get(item.id) !== item)
      out.push({ table, key: item.id, data: item, deleted: false });
    prevById.delete(item.id);
  }
  // Whatever is left existed before and is gone now. A forward-only scan of
  // `next` can never see these, which is why the key-set walk is required.
  for (const key of prevById.keys()) out.push({ table, key, deleted: true });
}

function diffByKey<T>(
  table: SyncedTable,
  prev: Record<string, T> | undefined,
  next: Record<string, T>,
  out: Change[],
): void {
  if (prev === next) return;
  const prevKeys = new Set(Object.keys(prev ?? {}));
  for (const [key, item] of Object.entries(next)) {
    if (!prev || prev[key] !== item) out.push({ table, key, data: item, deleted: false });
    prevKeys.delete(key);
  }
  for (const key of prevKeys) out.push({ table, key, deleted: true });
}

function diffSettings(prev: Db | null, next: Db, out: Change[]): void {
  if (prev && prev.settings === next.settings) return;
  for (const k of SYNCED_SETTING_KEYS) {
    if (prev && Object.is(prev.settings[k], next.settings[k])) continue;
    out.push({ table: "settings", key: k, data: { value: next.settings[k] }, deleted: false });
  }
}

/**
 * Returns the writes needed to bring storage from `prev` to `next`.
 * Pass `prev = null` on first persist to emit everything.
 *
 * Deleting a habit emits ONE habit tombstone, not one per log: the server
 * cascades child logs by `habitId` in the same statement, turning a 700-row push
 * into a 1-row push. Locally the orphaned logs are invisible — `getLog` is only
 * ever called with a habit drawn from `db.habits` — and the cascade's tombstones
 * come back down on the next pull, which is what actually clears them. (This
 * used to promise a local GC pass; there wasn't one, and there does not need to
 * be.)
 */
export function diffDb(prev: Db | null, next: Db): Change[] {
  const out: Change[] = [];
  if (prev === next) return out;

  // Listed explicitly rather than driven by a table: the generic form needs
  // casts that erase exactly the type safety this file most depends on.
  diffById("categories", prev?.categories, next.categories, out);
  diffById("habits", prev?.habits, next.habits, out);
  diffById("tasks", prev?.tasks, next.tasks, out);
  diffById("timerSessions", prev?.timerSessions, next.timerSessions, out);
  diffById("feedback", prev?.feedback, next.feedback, out);
  // Keyed collections have natural, device-stable keys (`habitId|dateKey`,
  // `dateKey`), which makes them the best-behaved entities in the sync design.
  diffByKey("logs", prev?.logs, next.logs, out);
  diffByKey("journal", prev?.journal, next.journal, out);
  diffSettings(prev, next, out);
  return out;
}
