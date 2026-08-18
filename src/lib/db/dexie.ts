/**
 * IndexedDB schema — replaces the single `routino:v1` localStorage blob.
 *
 * Why: `saveDb` re-serialised the entire `Db` to a string, synchronously, on
 * every keystroke. Here each record is its own row, so a write touches only what
 * changed and never blocks the main thread.
 *
 * Sync metadata lives in this row wrapper, never inside the entity types. That
 * keeps the in-memory `Db` byte-identical to what the UI has always seen, so
 * `logic.ts` and every `{...habit, name}` spread keep working untouched — and it
 * avoids colliding with `JournalEntry.updatedAt`, which is domain data.
 */
import Dexie, { type Table } from "dexie";
import type {
  Category,
  Feedback,
  Habit,
  HabitLog,
  JournalEntry,
  Task,
  TimerSession,
} from "../store";

/** One stored record. `data` is the entity exactly as the UI knows it. */
export interface RecordRow<T> {
  key: string;
  data: T;
  /** Epoch ms, client-assigned. The LWW key. The server clamps this on push —
   * a device with a clock set to 2099 would otherwise win every conflict forever. */
  updatedAt: number;
  /** Tombstone. Deletes must be rows, not absences, or they can't propagate. */
  deleted: 0 | 1;
  /** Outbox flag: pending push. Indexed, so the sync engine can query it. */
  dirty: 0 | 1;
  /**
   * Local insertion order. IndexedDB returns rows sorted by primary key, so
   * without this the UI's lists would reshuffle into `uid()` order — habits and
   * tasks would appear random, categories would go alphabetical instead of the
   * curated order, and timer history would lose newest-first.
   *
   * The old blob got this for free from array order. It is presentation state,
   * assigned on insert and preserved across edits, and is never sent to the
   * server.
   */
  seq: number;
}

/* Monotonic local ordering counter, primed from storage on hydrate/migrate. */
let seqCounter = 0;

export function primeSeq(maxSeen: number): void {
  seqCounter = Math.max(seqCounter, maxSeen);
}

export function nextSeq(): number {
  return ++seqCounter;
}

/** A single settings field. Settings are stored per-field rather than as one
 * object because whole-object LWW silently eats concurrent edits: theme changed
 * on the phone at t=10 and language on the laptop at t=11 would drop the theme. */
export type SettingRow = RecordRow<{ value: unknown }>;

/** Tables that sync. `feedback` is push-only (it never comes back to a device)
 * but lives here so it survives being offline. */
export type SyncedTable =
  | "categories"
  | "habits"
  | "logs"
  | "tasks"
  | "timerSessions"
  | "journal"
  | "settings"
  | "feedback";

export const SYNCED_TABLES: SyncedTable[] = [
  "categories",
  "habits",
  "logs",
  "tasks",
  "timerSessions",
  "journal",
  "settings",
  "feedback",
];

/**
 * Sync bookkeeping: how far this device has read the server's change log.
 *
 * Deliberately a table in IndexedDB rather than a localStorage key, so it shares
 * a fate with the records it describes. Those were two different stores with two
 * different eviction policies — Safari drops IndexedDB under storage pressure, a
 * failed Dexie upgrade drops it, "clear site data" can take one and leave the
 * other — and a cursor that outlives its records is worse than no cursor at all:
 * the device asks for "everything above 5", is correctly told there is nothing
 * new, and shows the user an empty app that their data can never come back into.
 * Wiped together, the next sync simply pulls the account again from zero.
 */
export interface SyncMetaRow {
  key: "cursor";
  /** Phone that owns this cursor. Another account signing in starts from zero —
   * its records are a different log entirely. */
  owner: string | null;
  cursor: number;
  lastSyncedAt: number;
}

export class RoutinoDexie extends Dexie {
  categories!: Table<RecordRow<Category>, string>;
  habits!: Table<RecordRow<Habit>, string>;
  logs!: Table<RecordRow<HabitLog>, string>;
  tasks!: Table<RecordRow<Task>, string>;
  timerSessions!: Table<RecordRow<TimerSession>, string>;
  journal!: Table<RecordRow<JournalEntry>, string>;
  settings!: Table<SettingRow, string>;
  feedback!: Table<RecordRow<Feedback>, string>;
  syncMeta!: Table<SyncMetaRow, string>;

  constructor(name = "routino") {
    super(name);
    // `key` is the primary key everywhere. Composite-keyed entities get a natural
    // one (`habitId|dateKey`, `dateKey`); the rest use their existing uid().
    // `dirty` is indexed to make the outbox scan cheap.
    this.version(1).stores({
      categories: "key, dirty, seq",
      habits: "key, dirty, seq",
      logs: "key, dirty, seq",
      tasks: "key, dirty, seq",
      timerSessions: "key, dirty, seq",
      journal: "key, dirty, seq",
      settings: "key, dirty, seq",
      feedback: "key, dirty, seq",
    });
    // Dexie's `.stores()` is a DELTA: only the changed table is named, the eight
    // above are inherited untouched. Adding a store needs no upgrade function.
    this.version(2).stores({ syncMeta: "key" });
  }
}

/**
 * Live binding to the currently selected account vault.
 *
 * Every storage module imports this binding rather than capturing a table, so
 * changing it during an account switch makes all subsequent writes target the
 * selected vault without copying or deleting another account's rows.
 */
export let db = new RoutinoDexie();

export async function useDatabase(name: string): Promise<void> {
  if (db.name === name && db.isOpen()) return;
  db.close();
  db = new RoutinoDexie(name);
  await db.open();
}

/** Wraps a fresh entity for storage. Callers that are applying a remote record
 * pass `dirty: 0` — only local edits go in the outbox. */
export function row<T>(
  key: string,
  data: T,
  updatedAt = Date.now(),
  dirty: 0 | 1 = 1,
): RecordRow<T> {
  return { key, data, updatedAt, deleted: 0, dirty, seq: nextSeq() };
}
