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
import {
  exchangeRecords,
  type ExchangeResponse,
  type RejectedSyncRecord,
  type RemoteRecord,
  type SyncRecord,
} from "../api/sync";
import { hasSession, type ServerEntitlement } from "../api/auth";
import { db as idb, nextSeq, type RecordRow, type SyncMetaRow } from "../db/dexie";
import type { HabitLog } from "../store";
import { expandHabitMonthRecord, packHabitLogRows } from "./habit-month";
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
interface SourceRow {
  table: SyncableTable;
  row: RecordRow<unknown>;
}

interface OutgoingPacket {
  record: SyncRecord;
  sources: SourceRow[];
}

async function collectOutbox(): Promise<OutgoingPacket[]> {
  const out: OutgoingPacket[] = [];
  for (const table of SYNCABLE_TABLES) {
    const rows = await tableOf(table).where("dirty").equals(1).toArray();
    if (table === "logs") {
      const packed = packHabitLogRows(rows as RecordRow<HabitLog>[]);
      for (const packet of packed) {
        out.push({
          record: packet.record,
          sources: packet.sources.map((row) => ({ table: "logs", row })),
        });
      }
      continue;
    }
    for (const row of rows) out.push({ record: toWire(table, row), sources: [{ table, row }] });
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

const rejectionKey = (record: Pick<RejectedSyncRecord, "kind" | "id" | "updatedAt">) =>
  `${record.kind}\u0000${record.id}\u0000${record.updatedAt}`;

const encoder = new TextEncoder();

function chunk(items: OutgoingPacket[]) {
  const chunks: (typeof items)[] = [];
  let current: typeof items = [];
  let bytes = 0;
  let keys = new Set<string>();
  for (const item of items) {
    const size = encoder.encode(JSON.stringify(item.record)).byteLength;
    const key = `${item.record.kind}\u0000${item.record.id}`;
    if (
      current.length &&
      (current.length >= MAX_CHUNK_RECORDS || bytes + size > MAX_CHUNK_BYTES || keys.has(key))
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
      keys = new Set<string>();
    }
    current.push(item);
    bytes += size;
    keys.add(key);
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
  if (sent.length === 0) return;
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
  const deletedMonths: RemoteRecord[] = [];
  for (const r of records) {
    if (r.kind === "habitMonths") {
      if (r.deleted) deletedMonths.push(r);
      else {
        for (const expanded of expandHabitMonthRecord(r)) {
          const list = byTable.get("logs");
          if (list) list.push(expanded);
          else byTable.set("logs", [expanded]);
        }
      }
      continue;
    }
    // Protocol v2 never accepts raw cloud logs. Daily rows exist only inside
    // IndexedDB; the server representation is habitMonths.
    if (r.kind === "logs") continue;
    if (!(SYNCABLE_TABLES as readonly string[]).includes(r.kind)) continue;
    const table = r.kind as SyncableTable;
    const list = byTable.get(table);
    if (list) list.push(r);
    else byTable.set(table, [r]);
  }
  if (byTable.size === 0 && deletedMonths.length === 0) return 0;

  if (deletedMonths.length) byTable.set("logs", byTable.get("logs") ?? []);

  let written = 0;
  await idb.transaction("rw", [...byTable.keys()].map(tableOf), async () => {
    for (const [table, remotes] of byTable) {
      if (table === "logs" && deletedMonths.length) {
        for (const month of deletedMonths) {
          const locals = await idb.logs.where("key").startsWith(`${month.id}-`).toArray();
          const tombstones = locals
            .map((local) =>
              mergeRemote(
                local,
                {
                  kind: "logs",
                  id: local.key,
                  data: null,
                  updatedAt: month.updatedAt,
                  deleted: true,
                  seq: month.seq,
                },
                nextSeq,
              ),
            )
            .filter((row): row is RecordRow<unknown> => row !== null);
          if (tombstones.length) {
            await idb.logs.bulkPut(tombstones as RecordRow<HabitLog>[]);
            written += tombstones.length;
          }
        }
      }
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

export interface SyncOptions {
  includeAccountState?: boolean;
  keepalive?: boolean;
  /** Send an empty exchange when there is no outbox. Boot/foreground use this;
   * ordinary edit batching does not need an empty request. */
  pullRequired?: boolean;
}

/** Concurrent callers share one run. The app triggers sync from several places
 * (boot, visibility change, a debounce after edits) and two overlapping runs
 * would push the same rows twice and fight over the cursor. */
interface RunningSync {
  owner: string;
  options: SyncOptions;
  promise: Promise<SyncOutcome>;
}

let running: RunningSync | null = null;

export function syncNow(owner: string, options: SyncOptions = {}): Promise<SyncOutcome> {
  if (running?.owner === owner) {
    const followUpNeeded =
      (options.includeAccountState === true && running.options.includeAccountState !== true) ||
      (options.pullRequired !== false && running.options.pullRequired === false);
    if (!followUpNeeded) return running.promise;
    return running.promise.then(
      () => syncNow(owner, options),
      () => syncNow(owner, options),
    );
  }
  if (running) {
    return running.promise.then(
      () => syncNow(owner, options),
      () => syncNow(owner, options),
    );
  }

  const promise = run(owner, options).finally(() => {
    if (running?.promise === promise) running = null;
  });
  running = { owner, options, promise };
  return promise;
}

export async function hasPendingChanges(): Promise<boolean> {
  return (await collectOutbox()).length > 0;
}

async function run(owner: string, options: SyncOptions): Promise<SyncOutcome> {
  if (!hasSession()) return { pushed: 0, pulled: 0, rejected: 0, remoteChanged: false };

  let state = await loadSyncState(owner);
  let pushed = 0;
  let pulled = 0;
  let resetApplied = false;
  let entitlement: ServerEntitlement | undefined;

  const outbox = await collectOutbox();
  const batches = chunk(outbox);
  let rejected = 0;
  let exchanged = false;
  let accountStateReceived = false;

  const applyPage = async (page: ExchangeResponse): Promise<void> => {
    if (page.reset) {
      await wipeSyncedTables();
      resetApplied = true;
      state = { ...state, owner, cursor: 0 };
      await saveSyncState(state);
      return;
    }
    pulled += await applyRemote(page.records);
    state = { ...state, owner, cursor: page.cursor };
    if (page.entitlement !== undefined) {
      entitlement = page.entitlement;
      accountStateReceived = true;
    }
    rejected += page.rejectedRecords?.length ?? 0;
  };

  const exchangePage = async (
    batch: typeof outbox,
    includeAccountState: boolean,
  ): Promise<ExchangeResponse> => {
    const page = await exchangeRecords(
      {
        protocolVersion: 2,
        cursor: state.cursor,
        records: batch.map(({ record }) => record),
        includeAccountState,
      },
      owner,
      options.keepalive,
    );
    exchanged = true;
    await applyPage(page);
    return page;
  };

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    let page = await exchangePage(
      batch,
      options.includeAccountState === true && index === batches.length - 1,
    );
    const refused = new Set((page.rejectedRecords ?? []).map(rejectionKey));
    await clearDirty(
      batch
        .filter(({ record }) => !refused.has(rejectionKey(record)))
        .flatMap(({ sources }) => sources),
    );
    pushed += page.applied;

    let guard = 0;
    while (page.reset || page.hasMore) {
      if (++guard > 200) break;
      page = await exchangePage([], options.includeAccountState === true);
    }
  }

  // No outbox means no request unless a lifecycle trigger explicitly needs a
  // pull/account refresh. If the final batch was permanently rejected, an
  // account-state request still gets one empty exchange.
  if (
    (!exchanged && (options.pullRequired !== false || options.includeAccountState)) ||
    (options.includeAccountState && !accountStateReceived)
  ) {
    let page = await exchangePage([], options.includeAccountState === true);
    let guard = 0;
    while (page.reset || page.hasMore) {
      if (++guard > 200) break;
      page = await exchangePage([], options.includeAccountState === true);
    }
  }

  await saveSyncState({ ...state, owner, lastSyncedAt: Date.now() });
  return { pushed, pulled, rejected, remoteChanged: resetApplied || pulled > 0, entitlement };
}
