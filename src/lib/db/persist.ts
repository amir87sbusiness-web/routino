/**
 * Applies a `Change[]` from `diffDb` to IndexedDB.
 *
 * Never awaited by the UI. Writes land in the background; the in-memory `Db` is
 * already the source of truth for what's on screen. That is what makes "offline
 * and online are indistinguishable" a structural property rather than a promise.
 */
import { db as idb, nextSeq, type RecordRow } from "./dexie";
import type { Change } from "./diff";

function tableOf(name: Change["table"]) {
  return idb.table<RecordRow<unknown>, string>(name);
}

/**
 * Writes changes, stamping `updatedAt` and marking rows dirty for a later push.
 *
 * Tombstones keep their row: a delete has to be a record, not an absence, or it
 * can never propagate to another device.
 */
export async function applyChanges(changes: Change[], now = Date.now()): Promise<void> {
  if (changes.length === 0) return;

  const byTable = new Map<Change["table"], Change[]>();
  for (const c of changes) {
    const list = byTable.get(c.table);
    if (list) list.push(c);
    else byTable.set(c.table, [c]);
  }

  await idb.transaction("rw", [...byTable.keys()].map(tableOf), async () => {
    for (const [table, list] of byTable) {
      // An edit must keep its original `seq`, or the record would jump to the
      // end of its list every time the user touched it.
      const existing = await tableOf(table).bulkGet(list.map((c) => c.key));
      const rows: RecordRow<unknown>[] = list.map((c, i) => ({
        key: c.key,
        data: c.deleted ? null : c.data,
        updatedAt: now,
        deleted: c.deleted ? 1 : 0,
        dirty: 1,
        seq: existing[i]?.seq ?? nextSeq(),
      }));
      await tableOf(table).bulkPut(rows);
    }
  });
}

/** Rows awaiting push. The sync engine's outbox query (Phase 4). */
export async function pendingChanges(): Promise<Record<string, RecordRow<unknown>[]>> {
  const out: Record<string, RecordRow<unknown>[]> = {};
  for (const table of idb.tables) {
    const rows = await table.where("dirty").equals(1).toArray();
    if (rows.length) out[table.name] = rows;
  }
  return out;
}

/** Drops every local record. Used by tests and by a future "sign out and wipe". */
export async function clearAll(): Promise<void> {
  await idb.transaction("rw", idb.tables, async () => {
    await Promise.all(idb.tables.map((t) => t.clear()));
  });
}
