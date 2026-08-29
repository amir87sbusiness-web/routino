/**
 * Rebuilds the in-memory `Db` from IndexedDB + the device-local slice.
 *
 * The reconstructed object is shaped exactly like the old localStorage blob, so
 * every consumer (`logic.ts`, all the routes) is unaware storage changed at all.
 */
import { DEFAULT_CATEGORIES } from "../presets";
import {
  defaultDb,
  type Category,
  type Db,
  type Feedback,
  type Habit,
  type HabitLog,
  type JournalEntry,
  type Task,
  type TimerSession,
} from "../store";
import { db as idb, primeSeq, type RecordRow } from "./dexie";
import { loadLocal, type LocalState } from "./local";
import { migrateLegacyBlob } from "./migrate";
import { activateStoredVault } from "./vault";

/** Live rows only, in insertion order.
 *
 * The sort is load-bearing: IndexedDB hands rows back sorted by primary key, so
 * without it habits and tasks would appear in `uid()` order (i.e. random) and
 * categories alphabetically rather than in their curated order.
 *
 * Correct for collections the UI APPENDS to (habits, tasks, categories). For
 * anything prepended, see `liveNewestFirst`. */
function live<T>(rows: RecordRow<T>[]): T[] {
  return rows
    .filter((r) => !r.deleted)
    .sort((a, b) => a.seq - b.seq)
    .map((r) => r.data);
}

/** Live rows newest-first, ordered by a real timestamp on the entity.
 *
 * `timerSessions` is prepended by the UI and rendered newest-first, so seq-ASC
 * (insertion order) reverses it — the history panel would show the OLDEST
 * sessions and the `.slice(0, 200)` trim would discard the NEWEST. Ordering by
 * the entity's own timestamp is also what makes the trim deterministic across
 * devices once sync merges two histories. */
function liveNewestFirst<T>(rows: RecordRow<T>[], at: (x: T) => number): T[] {
  return rows
    .filter((r) => !r.deleted)
    .map((r) => r.data)
    .sort((a, b) => at(b) - at(a));
}

/** Keyed collections are looked up by key, never iterated for display, so their
 * order carries no meaning. */
function keyed<T>(rows: RecordRow<T>[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of rows) if (!r.deleted) out[r.key] = r.data;
  return out;
}

function maxSeq(...groups: RecordRow<unknown>[][]): number {
  let max = 0;
  for (const rows of groups) for (const r of rows) if (r.seq > max) max = r.seq;
  return max;
}

export interface HydrateResult {
  db: Db;
  local: LocalState;
  /** True when this boot imported the legacy blob. */
  migrated: boolean;
}

/**
 * A brand-new install has no rows at all. Seed the curated default categories as
 * real rows.
 *
 * Falling back to the `DEFAULT_CATEGORIES` constant at read time instead would
 * resurrect deleted defaults: deleting one writes a single tombstone, so on the
 * next boot the table holds only that tombstone, `live()` returns empty, and the
 * fallback would hand back all 16 again — including the deleted one.
 *
 * A user who deletes every category still has 16 tombstone rows, so `count()`
 * is non-zero and this correctly does nothing.
 *
 * Seeded `dirty: 0, updatedAt: 0` on purpose. `DEFAULT_CATEGORIES` have FIXED
 * ids, so a second device installing fresh would otherwise push 16 pristine
 * defaults stamped `now`, which beat the user's long-edited categories on
 * identical ids and wipe them server-side. At `updatedAt: 0` a default always
 * loses LWW and never pushes — safe, because every device seeds byte-identical
 * content under the same ids and converges anyway. Touching one makes it
 * `dirty: 1` with a real timestamp, and deleting one writes a real tombstone;
 * both still win over another device's untouched seed.
 */
async function seedIfEmpty(): Promise<void> {
  if ((await idb.categories.count()) > 0) return;
  await idb.categories.bulkPut(
    DEFAULT_CATEGORIES.map((c, i) => ({
      key: c.id,
      data: c,
      updatedAt: 0,
      deleted: 0 as const,
      dirty: 0 as const,
      seq: i + 1,
    })),
  );
  primeSeq(DEFAULT_CATEGORIES.length);
}

export async function hydrate(now = Date.now()): Promise<HydrateResult> {
  await activateStoredVault();
  const migrated = await migrateLegacyBlob(now);
  const local = loadLocal();
  await seedIfEmpty();

  const [categories, habits, logs, tasks, timerSessions, journal, feedback] =
    await Promise.all([
      idb.categories.toArray(),
      idb.habits.toArray(),
      idb.logs.toArray(),
      idb.tasks.toArray(),
      idb.timerSessions.toArray(),
      idb.journal.toArray(),
      idb.feedback.toArray(),
    ]);

  // Continue the ordering sequence rather than restarting it, so records added
  // this session sort after everything already stored.
  primeSeq(maxSeq(categories, habits, logs, tasks, timerSessions, journal, feedback));

  const fresh = defaultDb(DEFAULT_CATEGORIES);

  return {
    db: {
      ...fresh,
      categories: live<Category>(categories),
      habits: live<Habit>(habits),
      logs: keyed<HabitLog>(logs),
      tasks: live<Task>(tasks),
      timerSessions: liveNewestFirst<TimerSession>(timerSessions, (s) => s.endedAt),
      journal: keyed<JournalEntry>(journal),
      feedback: live<Feedback>(feedback),
      settings: local.settings,
      auth: local.auth,
      subscription: local.subscription,
      notifications: local.notifications,
      meta: local.meta,
    },
    local,
    migrated,
  };
}
