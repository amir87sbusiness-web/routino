/**
 * The engine against a fake server that behaves like the real one.
 *
 * These tests exist because the unit-level pieces (`mergeRemote`) were already
 * covered and correct while the engine still lost data: the bug was in how it
 * moved its cursor, which only shows up with TWO devices on one account. A fake
 * server that assigns sequence numbers the way `backend/src/services/sync.ts`
 * does is the smallest thing that can catch that class of mistake.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { PullResponse, PushResponse, RemoteRecord, SyncRecord } from "../api/sync";
import { defaultLocal, saveLocal } from "../db/local";
import { hydrate } from "../db/hydrate";
import { activateVault, LEGACY_VAULT_ID } from "../db/vault";
import { db as idb } from "../db/dexie";

/** A one-account change log, i.e. what the server actually is. */
const server = {
  log: [] as RemoteRecord[],
  seq: 0,
  resetNextPull: false,
  /** ids the server permanently refuses, e.g. an oversized journal entry. */
  refuse: new Set<string>(),
  /** Writes rows at the next sequence numbers, newest-wins per (kind, id). */
  push(records: SyncRecord[]): PushResponse {
    for (const r of records) {
      if (this.refuse.has(r.id)) throw new ApiError(400, "record_too_large", "too large");
    }
    let applied = 0;
    for (const r of records) {
      this.seq += 1;
      const existing = this.log.find((x) => x.kind === r.kind && x.id === r.id);
      if (existing && existing.updatedAt >= r.updatedAt) continue;
      if (existing) this.log.splice(this.log.indexOf(existing), 1);
      this.log.push({ ...r, seq: this.seq });
      applied += 1;
    }
    return { cursor: this.seq, applied, skipped: records.length - applied };
  },
  pull(cursor: number): PullResponse {
    if (this.resetNextPull) {
      this.resetNextPull = false;
      return { records: [], cursor, hasMore: true, reset: true };
    }
    const records = this.log.filter((r) => r.seq > cursor).sort((a, b) => a.seq - b.seq);
    return {
      records,
      cursor: records.length ? records[records.length - 1]!.seq : cursor,
      hasMore: false,
      reset: false,
    };
  },
  reset() {
    this.log = [];
    this.seq = 0;
    this.resetNextPull = false;
    this.refuse.clear();
  },
};

vi.mock("../api/auth", () => ({ hasSession: () => true }));
vi.mock("../api/sync", () => ({
  pushRecords: (records: SyncRecord[]) => Promise.resolve(server.push(records)),
  pullRecords: (cursor: number) => Promise.resolve(server.pull(cursor)),
}));

const { clearSyncState, syncNow } = await import("./engine");

const OWNER = "user-1";

beforeEach(async () => {
  server.reset();
  localStorage.clear();
  await activateVault(LEGACY_VAULT_ID);
  await clearSyncState();
  await Promise.all(idb.tables.map((t) => t.clear()));
});

async function useDevice(id: string) {
  await activateVault(`test-${id}`);
  await Promise.all(idb.tables.map((table) => table.clear()));
  await clearSyncState();
}

/** A pending local change, exactly as `persist.ts` would have left it. */
const habitData = (id: string, name: string) => ({
  id,
  name,
  categoryId: "general",
  type: "binary" as const,
  target: 1,
  schedule: { kind: "daily" as const },
  monthlyGoal: null,
  reminderTime: null,
  createdAt: 1,
});

async function localDirtyHabit(id: string, name: string, updatedAt = 2000) {
  await idb.table("habits").put({
    key: id,
    data: habitData(id, name),
    updatedAt,
    deleted: 0,
    dirty: 1,
    seq: 1,
  });
}

const localHabitNames = async () =>
  (await idb.table("habits").toArray()).map((r) => (r.data as { name: string } | null)?.name);

describe("sync engine, two devices on one account", () => {
  it("pulls the other device's change even when this one also has changes", async () => {
    // The laptop synced first: its habit sits at a LOW sequence number.
    server.push([
      {
        kind: "habits",
        id: "h-laptop",
        data: { id: "h-laptop", name: "دویدن" },
        updatedAt: 1000,
        deleted: false,
      },
    ]);

    // The phone has its own pending change and has never pulled.
    await localDirtyHabit("h-phone", "مطالعه");

    const outcome = await syncNow(OWNER);

    // Both must now be on the phone. Adopting the push cursor skipped the
    // laptop's row here, because that cursor sits ABOVE it.
    expect((await localHabitNames()).sort()).toEqual(["دویدن", "مطالعه"]);
    expect(outcome.remoteChanged).toBe(true);
  });

  it("clears the outbox and does not re-push settled rows", async () => {
    await localDirtyHabit("h1", "ورزش");

    const first = await syncNow(OWNER);
    expect(await idb.table("habits").where("dirty").equals(1).count()).toBe(0);
    expect(first.pushed).toBe(1);
    expect(first.remoteChanged).toBe(false);

    const seqAfterFirst = server.seq;
    const second = await syncNow(OWNER);
    expect(second.pushed).toBe(0);
    // Nothing was written, so no other device is woken up.
    expect(server.seq).toBe(seqAfterFirst);
  });

  it("applies a remote tombstone over a local row", async () => {
    await idb.table("habits").put({
      key: "h1",
      data: { id: "h1", name: "ورزش" },
      updatedAt: 1000,
      deleted: 0,
      dirty: 0,
      seq: 1,
    });
    server.push([{ kind: "habits", id: "h1", data: null, updatedAt: 5000, deleted: true }]);

    await syncNow(OWNER);

    expect((await idb.table("habits").get("h1"))?.deleted).toBe(1);
  });

  it("reports a reset as remote storage change even when the server is empty", async () => {
    await idb.table("habits").put({
      key: "stale",
      data: { id: "stale", name: "قدیمی" },
      updatedAt: 1000,
      deleted: 0,
      dirty: 0,
      seq: 1,
    });
    server.resetNextPull = true;

    const outcome = await syncNow(OWNER);

    expect(await idb.table("habits").get("stale")).toBeUndefined();
    expect(outcome.pushed).toBe(0);
    expect(outcome.pulled).toBe(0);
    expect(outcome.remoteChanged).toBe(true);
  });

  it("keeps syncing everything else when the server refuses one record", async () => {
    // A journal entry too big for the server to store. Before, this threw out of
    // the whole run: no other table pushed, the pull never happened, and the
    // account went dark with nothing reported anywhere.
    await idb.table("journal").put({
      key: "2026-08-01",
      data: { dateKey: "2026-08-01", text: "x".repeat(20_000) },
      updatedAt: 3000,
      deleted: 0,
      dirty: 1,
      seq: 1,
    });
    server.refuse.add("2026-08-01");

    // Something the other device wrote, which the pull must still deliver.
    server.push([
      {
        kind: "habits",
        id: "h-other",
        data: { id: "h-other", name: "شنا" },
        updatedAt: 1000,
        deleted: false,
      },
    ]);

    const outcome = await syncNow(OWNER);

    expect(outcome.rejected).toBe(1);
    expect(await localHabitNames()).toContain("شنا");
    // The refused row is kept, not discarded: it is the user's writing.
    expect((await idb.table("journal").get("2026-08-01"))?.dirty).toBe(1);
  });

  it("starts from zero when a different account signs in on this device", async () => {
    await localDirtyHabit("h1", "ورزش");
    await syncNow(OWNER);

    // A second account's log is a different log entirely; carrying the cursor
    // over would silently skip everything below it.
    server.reset();
    server.push([
      {
        kind: "habits",
        id: "h-other",
        data: { id: "h-other", name: "شنا" },
        updatedAt: 1000,
        deleted: false,
      },
    ]);
    await syncNow("989120000002");

    expect(await localHabitNames()).toContain("شنا");
  });
});

describe("storage that disappeared underneath us", () => {
  it("pulls the whole account back after IndexedDB is evicted", async () => {
    // Not hypothetical. The cursor used to live in localStorage while the records
    // lived in IndexedDB — two stores with two eviction policies. Safari drops
    // IndexedDB under storage pressure, a failed Dexie upgrade drops it, "clear
    // site data" can take one and leave the other. A surviving cursor was worse
    // than none: the device asked for "everything above 5", was correctly told
    // there was nothing, and showed an empty app the data could never return to.
    server.push([
      {
        kind: "habits",
        id: "h1",
        data: { id: "h1", name: "ورزش" },
        updatedAt: 1000,
        deleted: false,
      },
      {
        kind: "habits",
        id: "h2",
        data: { id: "h2", name: "مطالعه" },
        updatedAt: 1000,
        deleted: false,
      },
    ]);

    // A device that had synced all of it...
    await syncNow(OWNER);
    expect((await localHabitNames()).length).toBe(2);

    // ...then lost only its IndexedDB.
    await Promise.all(idb.tables.map((t) => t.clear()));

    await syncNow(OWNER);

    expect((await localHabitNames()).sort()).toEqual(["مطالعه", "ورزش"]);
  });
});

describe("multi-device acceptance", () => {
  it("moves a created habit and its completion from device A to device B", async () => {
    await useDevice("create-a");
    await localDirtyHabit("h1", "مطالعه", 1000);
    await idb.logs.put({
      key: "h1|2026-08-21",
      data: { habitId: "h1", dateKey: "2026-08-21", value: 1, done: true },
      updatedAt: 1100,
      deleted: 0,
      dirty: 1,
      seq: 2,
    });
    await syncNow(OWNER);

    await useDevice("create-b");
    await syncNow(OWNER);

    expect((await idb.habits.get("h1"))?.data).toMatchObject({ name: "مطالعه" });
    expect((await idb.logs.get("h1|2026-08-21"))?.data).toMatchObject({ done: true });
  });

  it("applies an offline tombstone on device B without resurrecting the habit", async () => {
    await useDevice("delete-a");
    await localDirtyHabit("h1", "ورزش", 1000);
    await syncNow(OWNER);

    await useDevice("delete-b");
    await syncNow(OWNER);
    expect((await idb.habits.get("h1"))?.deleted).toBe(0);

    await activateVault("test-delete-a");
    await idb.table("habits").put({
      key: "h1",
      data: null,
      updatedAt: 5000,
      deleted: 1,
      dirty: 1,
      seq: 1,
    });
    await syncNow(OWNER);

    await activateVault("test-delete-b");
    await syncNow(OWNER);
    await syncNow(OWNER);
    expect((await idb.habits.get("h1"))?.deleted).toBe(1);
    expect((await idb.habits.get("h1"))?.dirty).toBe(0);
  });

  it("converges conflicting habit edits by the existing LWW rule", async () => {
    await useDevice("lww-a");
    await localDirtyHabit("h1", "اولیه", 1000);
    await syncNow(OWNER);

    await useDevice("lww-b");
    await syncNow(OWNER);
    await localDirtyHabit("h1", "ویرایش قدیمی‌تر B", 2000);

    await activateVault("test-lww-a");
    await localDirtyHabit("h1", "ویرایش جدیدتر A", 3000);

    await activateVault("test-lww-b");
    await syncNow(OWNER);
    await activateVault("test-lww-a");
    await syncNow(OWNER);
    await activateVault("test-lww-b");
    await syncNow(OWNER);

    expect((await idb.habits.get("h1"))?.data).toMatchObject({ name: "ویرایش جدیدتر A" });
    await activateVault("test-lww-a");
    expect((await idb.habits.get("h1"))?.data).toMatchObject({ name: "ویرایش جدیدتر A" });
  });

  it("pushes an offline mutation after the same device closes and reopens", async () => {
    await useDevice("offline-reopen");
    await localDirtyHabit("h-offline", "آفلاین", 4000);

    await activateVault("temporary-other-app");
    await activateVault("test-offline-reopen");
    await syncNow(OWNER);

    expect(server.log.find((record) => record.id === "h-offline")?.data).toMatchObject({
      name: "آفلاین",
    });
    expect((await idb.habits.get("h-offline"))?.dirty).toBe(0);
  });

  it("rebuilds synced storage on reset while preserving device-local state", async () => {
    await useDevice("reset-local");
    saveLocal({
      ...defaultLocal(),
      auth: { userId: OWNER, phone: "989120000001", verifiedAt: 1 },
      theme: "dark",
      notificationsEnabled: false,
      notifications: [{ id: "local", title: "Local", body: "Keep", at: 1, read: false }],
    });
    await idb.habits.put({
      key: "stale",
      data: habitData("stale", "قدیمی"),
      updatedAt: 1,
      deleted: 0,
      dirty: 0,
      seq: 1,
    });
    server.push([
      {
        kind: "habits",
        id: "cloud",
        data: habitData("cloud", "ابر"),
        updatedAt: 2000,
        deleted: false,
      },
    ]);
    server.resetNextPull = true;

    const outcome = await syncNow(OWNER);
    const restored = (await hydrate()).db;

    expect(outcome.remoteChanged).toBe(true);
    expect(restored.habits.map((item) => item.id)).toEqual(["cloud"]);
    expect(restored.auth?.userId).toBe(OWNER);
    expect(restored.settings.theme).toBe("dark");
    expect(restored.settings.notificationsEnabled).toBe(false);
    expect(restored.notifications.map((item) => item.id)).toEqual(["local"]);
  });
});
