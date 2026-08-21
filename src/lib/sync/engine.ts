/**
 * The sync engine: push what this device changed, pull what the others did.
 *
 * Push runs BEFORE pull, always. Conflicts are last-write-wins, so a local edit
 * that has not reached the server yet would lose to an older remote copy if the
 * order were reversed — the user would watch their change get undone.
 *
 * Everything here is best-effort and silent. Offline is the normal state of an
 * offline-first app, not an error to report: the outbox simply stays full and
 * the next attempt drains it.
 */
import { pullRecords, pushRecords, type RemoteRecord, type SyncRecord } from "../api/sync";
import { ApiError } from "../api/client";
import { hasSession, type ServerEntitlement } from "../api/auth";
import { db as idb, nextSeq, type RecordRow, type SyncMetaRow } from "../db/dexie";
import { SYNCABLE_TABLES, mergeRemote, type SyncableTable } from "./merge";

/** Legacy home of the cursor. Read once so it can be DELETED — never adopted.
 * Adopting it would reintroduce the exact bug moving the cursor fixed: if
 * IndexedDB was the thing that got evicted, this key is a survivor pointing at
 * records that no longer exist locally. Starting from zero costs one full pull. */
const LEGACY_STATE_KEY = "routino:sync:v1";

/** Server caps a push at 200 records; the app caps a request body at 64 KB.
 * Whichever is hit first ends the chunk, so a page of long journal entries
 * chunks by size and a page of habits chunks by count. */
const MAX_CHUNK_RECORDS = 100;
const MAX_CHUNK_BYTES = 48 * 1024;

type SyncState = Omit<SyncMetaRow, "key">;

const emptyState = (): SyncState => ({ owner: null, cursor: 0, lastSyncedAt: 0 });

/**
 * This device's position in the account's change log.
 *
 * Stored in IndexedDB beside the records — see `SyncMetaRow` for why that is
 * load-bearing rather than tidy.
 */
export async function loadSyncState(owner: string): Promise<SyncState> {
  try {
    localStorage.removeItem(LEGACY_STATE_KEY);
  } catch {
    /* private mode; nothing to clean up */
  }
  try {
    const row = await idb.syncMeta.get("cursor");
    if (!row || row.owner !== owner) return emptyState();
    return { owner, cursor: row.cursor, lastSyncedAt: row.lastSyncedAt };
  } catch {
    return emptyState();
  }
}

async function saveSyncState(state: SyncState): Promise<void> {
  try {
    await idb.syncMeta.put({ key: "cursor", ...state });
  } catch {
    /* storage unavailable — the next sync re-pulls from the old cursor, which
       is wasteful but never wrong */
  }
}

export async function clearSyncState(): Promise<void> {
  try {
    await idb.syncMeta.clear();
  } catch {
    /* nothing to do */
  }
}

const tableOf = (name: SyncableTable) => idb.table<RecordRow<unknown>, string>(name);

/** Pending local changes, as the wire format. `seq` is never sent: it is this
 * device's presentation order, meaningless to anyone else. */
async function collectOutbox(): Promise<{ table: SyncableTable; row: RecordRow<unknown> }[]> {
  const out: { table: SyncableTable; row: RecordRow<unknown> }[] = [];
  for (const table of SYNCABLE_TABLES) {
    const rows = await tableOf(table).where("dirty").equals(1).toArray();
    for (const row of rows) out.push({ table, row });
  }
  return out;
}

const toWire = (table: SyncableTable, row: RecordRow<unknown>): SyncRecord => ({
  kind: table,
  id: row.key,
  data: row.deleted ? null : row.data,
  updatedAt: row.updatedAt,
  deleted: row.deleted === 1,
});

function chunk(items: { table: SyncableTable; row: RecordRow<unknown> }[]) {
  const chunks: (typeof items)[] = [];
  let current: typeof items = [];
  let bytes = 0;
  for (const item of items) {
    const size = JSON.stringify(toWire(item.table, item.row)).length;
    if (current.length && (current.length >= MAX_CHUNK_RECORDS || bytes + size > MAX_CHUNK_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Clears the outbox flag for rows that were just accepted.
 *
 * Re-reads each row and only clears it when `updatedAt` still matches what was
 * sent. Without that check, an edit made DURING the request would have its dirty
 * flag cleared along with the older value that actually reached the server, and
 * the newer one would never be pushed at all.
 */
async function clearDirty(
  sent: { table: SyncableTable; row: RecordRow<unknown> }[],
): Promise<void> {
  const byTable = new Map<SyncableTable, RecordRow<unknown>[]>();
  for (const { table, row } of sent) {
    const list = byTable.get(table);
    if (list) list.push(row);
    else byTable.set(table, [row]);
  }

  await idb.transaction("rw", [...byTable.keys()].map(tableOf), async () => {
    for (const [table, rows] of byTable) {
      const current = await tableOf(table).bulkGet(rows.map((r) => r.key));
      const settled = current
        .filter((c, i): c is RecordRow<unknown> => !!c && c.updatedAt === rows[i]!.updatedAt)
        .map((c) => ({ ...c, dirty: 0 as const }));
      if (settled.length) await tableOf(table).bulkPut(settled);
    }
  });
}

/** Writes accepted remote records. Returns how many actually changed anything. */
async function applyRemote(records: RemoteRecord[]): Promise<number> {
  const byTable = new Map<SyncableTable, RemoteRecord[]>();
  for (const r of records) {
    if (!(SYNCABLE_TABLES as readonly string[]).includes(r.kind)) continue;
    const table = r.kind as SyncableTable;
    const list = byTable.get(table);
    if (list) list.push(r);
    else byTable.set(table, [r]);
  }
  if (byTable.size === 0) return 0;

  let written = 0;
  await idb.transaction("rw", [...byTable.keys()].map(tableOf), async () => {
    for (const [table, remotes] of byTable) {
      const locals = await tableOf(table).bulkGet(remotes.map((r) => r.id));
      const rows = remotes
        .map((remote, i) => mergeRemote(locals[i], remote, nextSeq))
        .filter((r): r is RecordRow<unknown> => r !== null);
      if (rows.length) {
        await tableOf(table).bulkPut(rows);
        written += rows.length;
      }
    }
  });
  return written;
}

/** Drops every synced row so a reset can rebuild from the server's copy.
 * Device-local state (theme, sign-in, cached subscription) lives outside these
 * tables and is untouched. */
async function wipeSyncedTables(): Promise<void> {
  await idb.transaction("rw", SYNCABLE_TABLES.map(tableOf), async () => {
    await Promise.all(SYNCABLE_TABLES.map((t) => tableOf(t).clear()));
  });
}

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  /** Rows the server permanently refused (4xx). They stay dirty and are retried,
   * but they are the reason a device can be online and still not fully synced,
   * so the count is surfaced rather than hidden inside a console warning. */
  rejected: number;
  /** True only when remote/reset data changed product rows in IndexedDB. */
  remoteChanged: boolean;
  /**
   * The server's answer on this account's subscription, delivered on the last
   * pull page. Undefined when the sync never reached the server.
   *
   * The app applies THIS instead of calling `GET /subscriptions/me` — one fewer
   * Supabase invocation on every single app open, which is the metric the free
   * tier actually runs out of.
   */
  entitlement?: ServerEntitlement;
}

/** Concurrent callers share one run. The app triggers sync from several places
 * (boot, visibility change, a debounce after edits) and two overlapping runs
 * would push the same rows twice and fight over the cursor. */
interface RunningSync {
  owner: string;
  promise: Promise<SyncOutcome>;
}

let running: RunningSync | null = null;

export function syncNow(owner: string): Promise<SyncOutcome> {
  if (running?.owner === owner) return running.promise;
  if (running) {
    return running.promise.then(
      () => syncNow(owner),
      () => syncNow(owner),
    );
  }

  const promise = run(owner).finally(() => {
    if (running?.promise === promise) running = null;
  });
  running = { owner, promise };
  return promise;
}

async function run(owner: string): Promise<SyncOutcome> {
  if (!hasSession()) return { pushed: 0, pulled: 0, rejected: 0, remoteChanged: false };

  let state = await loadSyncState(owner);
  let pushed = 0;
  let pulled = 0;
  let resetApplied = false;
  let entitlement: ServerEntitlement | undefined;

  // ---- push ----
  const outbox = await collectOutbox();
  let rejected = 0;
  for (const batch of chunk(outbox)) {
    let res;
    try {
      res = await pushRecords(
        batch.map(({ table, row }) => toWire(table, row)),
        owner,
      );
    } catch (err) {
      // A 4xx is the server's permanent judgement on THESE rows — an oversized
      // journal entry is the realistic one. Retrying cannot fix it, and letting
      // it abort the run meant one bad row stopped every other table from
      // syncing AND stopped the pull, so the account silently went dark: no
      // error anywhere, just a phone that never saw the laptop again.
      //
      // The rows keep their dirty flag (nothing is thrown away) and the run
      // carries on with the rest. 401 is deliberately NOT swallowed: a dead
      // session is not a bad record, and the pull below would only fail too.
      if (
        err instanceof ApiError &&
        !err.offline &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 401
      ) {
        console.warn("sync: server rejected a batch, skipping it", err.code, err.message);
        rejected += batch.length;
        continue;
      }
      throw err;
    }
    await clearDirty(batch);
    pushed += res.applied;
    // The cursor is deliberately NOT advanced here. A push returns the log
    // position AFTER its own rows, and everything below that position includes
    // whatever the user's OTHER devices wrote since this one last pulled.
    // Adopting it therefore skips those rows permanently — the laptop's habit
    // simply never arrives on the phone. Re-downloading this device's own
    // writes on the next pull is the price, and it is nearly free: `mergeRemote`
    // drops them on the `local.updatedAt >= remote.updatedAt` tie, so they cost
    // bandwidth and nothing else.
  }

  // ---- pull ----
  let guard = 0;
  for (;;) {
    // A malformed server answer that always reports `hasMore` would spin here
    // forever and pin a phone's CPU. 200 pages is ~100k records — far past any
    // real account, and a bound is cheaper than trusting the peer.
    if (++guard > 200) break;

    const page = await pullRecords(state.cursor, undefined, owner);

    if (page.reset) {
      // This device sat below the tombstone purge line, so it cannot be brought
      // up to date incrementally without risking resurrected records. Start over.
      await wipeSyncedTables();
      resetApplied = true;
      state = { ...state, cursor: 0 };
      await saveSyncState({ ...state, owner });
      continue;
    }

    pulled += await applyRemote(page.records);
    state = { ...state, owner, cursor: page.cursor };
    if (!page.hasMore) {
      entitlement = page.entitlement;
      break;
    }
  }

  await saveSyncState({ ...state, owner, lastSyncedAt: Date.now() });
  return { pushed, pulled, rejected, remoteChanged: resetApplied || pulled > 0, entitlement };
}
