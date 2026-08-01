/**
 * One-way import of the legacy `routino:v1` localStorage blob into IndexedDB.
 *
 * The original blob is NEVER deleted. It costs one localStorage key and is the
 * only insurance against a bug in here — a migration that loses data is
 * otherwise unrecoverable, and it would hit 100% of existing users. Users can
 * also self-recover via Settings -> Export.
 *
 * Phase 1 has no network, so this only covers "local blob -> local IndexedDB".
 * Merging a local dataset into an account that already has server data (the
 * genuinely dangerous case) belongs with auth, and is not attempted here.
 */
import { db as idb, primeSeq, type RecordRow } from "./dexie";
import { saveLocal, SYNCED_SETTING_KEYS, type LocalState } from "./local";
import type { Db } from "../store";

const LEGACY_KEY = "routino:v1";
const MIGRATED_KEY = "routino:v1:migrated";

/** Legacy blobs may carry keys that were later dropped from `Db`. */
type LegacyDb = Db & { admin?: unknown; badges?: unknown };

export function hasLegacyBlob(): boolean {
  try {
    return localStorage.getItem(LEGACY_KEY) !== null && localStorage.getItem(MIGRATED_KEY) === null;
  } catch {
    return false;
  }
}

/* `seq` is taken from array/insertion position so the blob's ordering — which is
 * what the UI has always displayed — survives the move to per-record storage. */
let seqCursor = 0;

/**
 * `updatedAt` comes from the entity's own timestamp wherever it has one.
 *
 * Stamping everything `now` would make an old blob win every LWW conflict
 * against an account that already holds newer server data — and resurrect
 * habits the user deleted on another device. A habit created in 2024 should
 * carry 2024, not the moment it happened to be imported. Entities with no
 * timestamp at all (logs, tasks) fall back to `now`; they are keyed per-day, so
 * a real conflict needs the same habit on the same date.
 */
function rowsOf<T>(items: readonly T[], key: (x: T) => string, at: (x: T) => number): RecordRow<T>[] {
  return items.map((x) => ({ key: key(x), data: x, updatedAt: at(x), deleted: 0, dirty: 1, seq: ++seqCursor }));
}

function rowsOfRecord<T>(rec: Record<string, T>, at: (x: T) => number): RecordRow<T>[] {
  return Object.entries(rec).map(([key, data]) => ({ key, data, updatedAt: at(data), deleted: 0, dirty: 1, seq: ++seqCursor }));
}

/**
 * Imports the blob if present and not already imported. Returns true if it ran.
 *
 * Everything lands `dirty: 1` so that once auth and sync exist, the whole
 * dataset pushes to the server on first login.
 */
export async function migrateLegacyBlob(now = Date.now()): Promise<boolean> {
  if (!hasLegacyBlob()) return false;

  let legacy: LegacyDb;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)!) as LegacyDb;
  } catch {
    // Unparseable blob: mark it done rather than retrying this every boot. The
    // blob itself stays on disk for manual recovery.
    localStorage.setItem(MIGRATED_KEY, new Date(now).toISOString());
    return false;
  }

  await idb.transaction("rw", idb.tables, async () => {
    // Default categories keep updatedAt 0 for the same reason `seedIfEmpty` does:
    // they have fixed ids across devices, so an untouched default must never win
    // LWW against another device's edited copy. Custom categories have no
    // timestamp, so they take `now`.
    await idb.categories.bulkPut(rowsOf(legacy.categories ?? [], (c) => c.id, (c) => (c.isDefault ? 0 : now)));
    await idb.habits.bulkPut(rowsOf(legacy.habits ?? [], (h) => h.id, (h) => h.createdAt));
    await idb.tasks.bulkPut(rowsOf(legacy.tasks ?? [], (t) => t.id, () => now));
    await idb.timerSessions.bulkPut(rowsOf(legacy.timerSessions ?? [], (s) => s.id, (s) => s.endedAt));
    await idb.feedback.bulkPut(rowsOf(legacy.feedback ?? [], (f) => f.id, (f) => f.at));
    await idb.logs.bulkPut(rowsOfRecord(legacy.logs ?? {}, () => now));
    await idb.journal.bulkPut(rowsOfRecord(legacy.journal ?? {}, (j) => j.updatedAt));

    if (legacy.settings) {
      // Only keys the blob actually carries. Writing every key unconditionally
      // stored `{ value: undefined }` for fields the old install predated, and
      // those rows then overrode the real defaults on hydrate.
      await idb.settings.bulkPut(
        SYNCED_SETTING_KEYS.filter((k) => legacy.settings[k] !== undefined).map((k) => ({
          key: k,
          data: { value: legacy.settings[k] },
          updatedAt: now,
          deleted: 0 as const,
          dirty: 1 as const,
          seq: ++seqCursor,
        })),
      );
    }
  });
  primeSeq(seqCursor);

  // Device-local half goes to its own store, not IndexedDB.
  const local: LocalState = {
    auth: legacy.auth ?? null,
    // Carrying this across is what stops every existing user — trial or paid —
    // from being locked out on the launch after they update.
    subscription: legacy.subscription ?? null,
    notifications: legacy.notifications ?? [],
    meta: legacy.meta,
    theme: legacy.settings?.theme ?? "light",
    notificationsEnabled: legacy.settings?.notificationsEnabled ?? true,
  };
  saveLocal(local);

  localStorage.setItem(MIGRATED_KEY, new Date(now).toISOString());
  return true;
}
