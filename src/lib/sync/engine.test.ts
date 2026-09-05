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
import type {
  ExchangeRequest,
  ExchangeResponse,
  PullResponse,
  PushResponse,
  RejectedSyncRecord,
  RemoteRecord,
  SyncRecord,
  SyncRejectionCode,
} from "../api/sync";
import { defaultLocal, saveLocal } from "../db/local";
import { hydrate } from "../db/hydrate";
import { activateVault, LEGACY_VAULT_ID } from "../db/vault";
import { db as idb } from "../db/dexie";
import { applyChanges } from "../db/persist";

/** A one-account change log, i.e. what the server actually is. */
const server = {
  log: [] as RemoteRecord[],
  seq: 0,
  resetNextPull: false,
  rejectNextBatchForReset: false,
  exchanges: [] as ExchangeRequest[],
  /** ids the server permanently refuses, e.g. an oversized journal entry. */
  refuse: new Set<string>(),
  refuseCode: "record_too_large" as SyncRejectionCode,
  refuseRetryAt: new Map<string, number | undefined>(),
  afterExchange: null as null | (() => Promise<void>),
  /** Writes rows at the next sequence numbers, newest-wins per (kind, id). */
  push(records: SyncRecord[]): PushResponse {
    const accepted = records.filter((record) => !this.refuse.has(record.id));
    const rejectedRecords = records
      .filter((record) => this.refuse.has(record.id))
      .map((record): RejectedSyncRecord => {
        const retryAt = this.refuseRetryAt.get(record.id);
        return {
          kind: record.kind,
          id: record.id,
          updatedAt: record.updatedAt,
          code: this.refuseCode,
          ...(retryAt === undefined ? {} : { retryAt }),
        };
      });
    let applied = 0;
    for (const r of accepted) {
      this.seq += 1;
      const existing = this.log.find((x) => x.kind === r.kind && x.id === r.id);
      if (existing && existing.updatedAt >= r.updatedAt) continue;
      if (existing) this.log.splice(this.log.indexOf(existing), 1);
      this.log.push({ ...r, seq: this.seq });
      applied += 1;
    }
    return {
      cursor: this.seq,
      applied,
      skipped: accepted.length - applied,
      rejectedRecords,
    };
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
  exchange(request: ExchangeRequest): ExchangeResponse {
    this.exchanges.push(structuredClone(request));
    if (this.rejectNextBatchForReset) {
      this.rejectNextBatchForReset = false;
      this.resetNextPull = false;
      return {
        records: [],
        cursor: 0,
        hasMore: true,
        reset: true,
        batchAccepted: false,
        applied: 0,
        skipped: 0,
        rejectedRecords: [],
      } as ExchangeResponse;
    }
    const pushed = this.push(request.records);
    const pulled = this.pull(request.cursor);
    return {
      ...pulled,
      applied: pushed.applied,
      skipped: pushed.skipped,
      rejectedRecords: pushed.rejectedRecords,
      batchAccepted: true,
    };
  },
  reset() {
    this.log = [];
    this.seq = 0;
    this.resetNextPull = false;
    this.rejectNextBatchForReset = false;
    this.exchanges = [];
    this.refuse.clear();
    this.refuseCode = "record_too_large";
    this.refuseRetryAt.clear();
    this.afterExchange = null;
  },
};

vi.mock("../api/auth", () => ({ hasSession: () => true }));
vi.mock("../api/sync", () => ({
  pushRecords: (records: SyncRecord[]) => Promise.resolve(server.push(records)),
  pullRecords: (cursor: number) => Promise.resolve(server.pull(cursor)),
  exchangeRecords: async (request: ExchangeRequest) => {
    const response = server.exchange(request);
    await server.afterExchange?.();
    return response;
  },
}));

const { clearSyncState, hasPendingChanges, syncNow } = await import("./engine");

const OWNER = "user-1";

beforeEach(async () => {
  vi.restoreAllMocks();
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

async function localDirtyLog(habitId: string, dateKey: string, updatedAt: number, note?: string) {
  await idb.logs.put({
    key: `${habitId}|${dateKey}`,
    data: { habitId, dateKey, value: 1, done: true, note },
    updatedAt,
    deleted: 0,
    dirty: 1,
    seq: updatedAt,
  });
}

const taskData = (id: string, title: string) => ({
  id,
  dateKey: "2026-09-01",
  title,
  type: "binary" as const,
  target: 1,
  value: 0,
  done: false,
});

async function localDirtyTask(id: string, title: string, updatedAt = 1000) {
  await idb.tasks.put({
    key: id,
    data: taskData(id, title),
    updatedAt,
    deleted: 0,
    dirty: 1,
    seq: 1,
  });
}

const localHabitNames = async () =>
  (await idb.table("habits").toArray()).map((r) => (r.data as { name: string } | null)?.name);

describe("sync engine, two devices on one account", () => {
  it("uses one exchange for the common one-chunk sync", async () => {
    await localDirtyHabit("h1", "ورزش");

    await syncNow(OWNER);

    expect(server.exchanges).toHaveLength(1);
    expect(server.exchanges[0]).toMatchObject({
      protocolVersion: 2,
      cursor: 0,
      records: [expect.objectContaining({ id: "h1" })],
    });
  });

  it("packs dirty daily logs into one month record and settles their exact local versions", async () => {
    await localDirtyLog("h1", "2026-08-01", 100);
    await localDirtyLog("h1", "2026-08-02", 200);

    await syncNow(OWNER);

    expect(server.exchanges).toHaveLength(1);
    expect(server.exchanges[0]!.records).toEqual([
      expect.objectContaining({
        kind: "habitMonths",
        id: "h1|2026-08",
        updatedAt: 200,
        data: expect.objectContaining({
          habitId: "h1",
          monthKey: "2026-08",
          cells: expect.objectContaining({
            "01": expect.objectContaining({ updatedAt: 100 }),
            "02": expect.objectContaining({ updatedAt: 200 }),
          }),
        }),
      }),
    ]);
    expect(await idb.logs.where("dirty").equals(1).count()).toBe(0);
  });

  it("keeps every source day dirty when its month packet is rejected", async () => {
    await localDirtyLog("h1", "2026-08-01", 100);
    await localDirtyLog("h1", "2026-08-02", 200);
    server.refuse.add("h1|2026-08");

    const outcome = await syncNow(OWNER);

    expect(outcome.rejected).toBe(1);
    expect(await idb.logs.where("dirty").equals(1).count()).toBe(2);
  });

  it("pauses an exact quota-rejected version and wakes it at the earliest retry time", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(5_000);
    const retryAt = 10_000;
    await localDirtyTask("quota-task", "پیاده‌روی");
    server.refuse.add("quota-task");
    server.refuseCode = "account_quota_exceeded";
    server.refuseRetryAt.set("quota-task", retryAt);

    const outcome = await syncNow(OWNER);

    expect(outcome).toMatchObject({ rejected: 1, quotaExceeded: true });
    expect((await idb.tasks.get("quota-task"))?.dirty).toBe(2);
    expect(await hasPendingChanges()).toBe(false);
    expect(await idb.syncMeta.get("cursor")).toMatchObject({ owner: OWNER, quotaRetryAt: retryAt });

    server.refuse.clear();
    now.mockReturnValue(retryAt - 1);
    await syncNow(OWNER, { pullRequired: true });
    expect(server.exchanges.at(-1)?.records).toEqual([]);
    expect((await idb.tasks.get("quota-task"))?.dirty).toBe(2);

    now.mockReturnValue(retryAt);
    await syncNow(OWNER, { pullRequired: true });
    expect(server.exchanges.at(-1)?.records).toEqual([
      expect.objectContaining({ kind: "tasks", id: "quota-task", updatedAt: 1000 }),
    ]);
    expect((await idb.tasks.get("quota-task"))?.dirty).toBe(0);
    expect(await idb.syncMeta.get("cursor")).not.toHaveProperty("quotaRetryAt");
  });

  it("reports a paused row as pending exactly when its retry time is due", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(5_000);
    await localDirtyTask("quota-due", "موعد بازگشت");
    await idb.tasks.where("key").equals("quota-due").modify({ dirty: 2 });
    await idb.syncMeta.put({
      key: "cursor",
      owner: OWNER,
      cursor: 0,
      lastSyncedAt: 1,
      quotaRetryAt: 10_000,
    });

    expect(await hasPendingChanges(OWNER)).toBe(false);
    now.mockReturnValue(10_000);
    expect(await hasPendingChanges(OWNER)).toBe(true);
    expect(await hasPendingChanges("another-owner")).toBe(false);
  });

  it("lets an ordinary edit immediately unblock a quota-paused version", async () => {
    await localDirtyTask("quota-edit", "نسخه قبلی", 1_000);
    server.refuse.add("quota-edit");
    server.refuseCode = "account_quota_exceeded";
    server.refuseRetryAt.set("quota-edit", 10_000);
    await syncNow(OWNER);

    await applyChanges(
      [
        {
          table: "tasks",
          key: "quota-edit",
          data: taskData("quota-edit", "نسخه جدید"),
          deleted: false,
        },
      ],
      2_000,
    );

    expect((await idb.tasks.get("quota-edit"))?.dirty).toBe(1);
    expect((await idb.tasks.get("quota-edit"))?.updatedAt).toBe(2_000);
    expect(await hasPendingChanges()).toBe(true);
  });

  it("does not quota-pause a newer local version written while the rejected version is in flight", async () => {
    await localDirtyTask("quota-newer", "نسخه ارسالی", 1_000);
    server.refuse.add("quota-newer");
    server.refuseCode = "account_quota_exceeded";
    server.refuseRetryAt.set("quota-newer", 10_000);
    server.afterExchange = async () => {
      server.afterExchange = null;
      await localDirtyTask("quota-newer", "نسخه جدیدتر", 2_000);
    };

    await syncNow(OWNER);

    expect((await idb.tasks.get("quota-newer"))?.dirty).toBe(1);
    expect((await idb.tasks.get("quota-newer"))?.updatedAt).toBe(2_000);
  });

  it("keeps quota retry timestamps isolated by owner", async () => {
    const ownerRetryAt = 10_000;
    await idb.syncMeta.put({
      key: "cursor",
      owner: OWNER,
      cursor: 7,
      lastSyncedAt: 1,
      quotaRetryAt: ownerRetryAt,
    });
    await localDirtyTask("other-owner-task", "حساب دوم", 1_000);

    await syncNow("user-2");

    expect(server.exchanges.at(-1)?.records).toEqual([
      expect.objectContaining({ kind: "tasks", id: "other-owner-task" }),
    ]);
    expect(await idb.syncMeta.get("cursor")).toMatchObject({ owner: "user-2" });
    expect(await idb.syncMeta.get("cursor")).not.toHaveProperty("quotaRetryAt");
  });

  it("stores the earliest valid quota retry time for the owner", async () => {
    await localDirtyTask("quota-later", "دیرتر", 1_000);
    await localDirtyTask("quota-earlier", "زودتر", 2_000);
    server.refuse.add("quota-later");
    server.refuse.add("quota-earlier");
    server.refuseCode = "account_quota_exceeded";
    server.refuseRetryAt.set("quota-later", 20_000);
    server.refuseRetryAt.set("quota-earlier", 10_000);

    await syncNow(OWNER);

    expect(await idb.syncMeta.get("cursor")).toMatchObject({ quotaRetryAt: 10_000 });
    expect((await idb.tasks.get("quota-later"))?.dirty).toBe(2);
    expect((await idb.tasks.get("quota-earlier"))?.dirty).toBe(2);
  });

  it("leaves a quota rejection without retryAt eligible for the next lifecycle run", async () => {
    await localDirtyTask("quota-legacy", "سرور قدیمی", 1_000);
    server.refuse.add("quota-legacy");
    server.refuseCode = "account_quota_exceeded";

    await syncNow(OWNER);

    expect(server.exchanges).toHaveLength(1);
    expect((await idb.tasks.get("quota-legacy"))?.dirty).toBe(1);
    expect(await idb.syncMeta.get("cursor")).not.toHaveProperty("quotaRetryAt");

    server.refuse.clear();
    await syncNow(OWNER, { pullRequired: true });
    expect(server.exchanges).toHaveLength(2);
    expect(server.exchanges.at(-1)?.records).toEqual([
      expect.objectContaining({ kind: "tasks", id: "quota-legacy" }),
    ]);
    expect((await idb.tasks.get("quota-legacy"))?.dirty).toBe(0);
  });

  it("preserves quota-rejected local data when the same exchange requires a reset", async () => {
    await localDirtyTask("quota-reset", "نباید پاک شود", 1_000);
    server.refuse.add("quota-reset");
    server.refuseCode = "account_quota_exceeded";
    server.refuseRetryAt.set("quota-reset", 10_000);
    server.resetNextPull = true;

    const outcome = await syncNow(OWNER);

    expect(await idb.tasks.get("quota-reset")).toMatchObject({
      data: taskData("quota-reset", "نباید پاک شود"),
      updatedAt: 1_000,
      dirty: 2,
    });
    expect(await idb.syncMeta.get("cursor")).toMatchObject({
      owner: OWNER,
      quotaRetryAt: 10_000,
    });
    expect(outcome).toMatchObject({ rejected: 1, quotaExceeded: true });
  });

  it("expands a pulled server month into the unchanged local daily rows", async () => {
    server.push([
      {
        kind: "habitMonths",
        id: "h1|2026-08",
        data: {
          habitId: "h1",
          monthKey: "2026-08",
          cells: {
            "01": {
              value: 1,
              done: true,
              updatedAt: 100,
              deleted: false,
            },
            "02": { updatedAt: 200, deleted: true },
          },
        },
        updatedAt: 200,
        deleted: false,
      },
    ]);

    await syncNow(OWNER);

    expect((await idb.logs.get("h1|2026-08-01"))?.data).toMatchObject({ done: true });
    expect((await idb.logs.get("h1|2026-08-02"))?.deleted).toBe(1);
  });

  it("applies a deleted server month only to local days inside that month", async () => {
    await localDirtyLog("h1", "2026-08-01", 100);
    await localDirtyLog("h1", "2026-09-01", 100);
    await idb.logs.toCollection().modify({ dirty: 0 });
    server.push([
      {
        kind: "habitMonths",
        id: "h1|2026-08",
        data: null,
        updatedAt: 300,
        deleted: true,
      },
    ]);

    await syncNow(OWNER);

    expect((await idb.logs.get("h1|2026-08-01"))?.deleted).toBe(1);
    expect((await idb.logs.get("h1|2026-09-01"))?.deleted).toBe(0);
  });

  it("does not settle a newer daily edit made while its month packet is in flight", async () => {
    await localDirtyLog("h1", "2026-08-01", 100);
    server.afterExchange = async () => {
      server.afterExchange = null;
      await localDirtyLog("h1", "2026-08-01", 300, "newer");
    };

    await syncNow(OWNER);

    expect((await idb.logs.get("h1|2026-08-01"))?.dirty).toBe(1);
    expect((await idb.logs.get("h1|2026-08-01"))?.data).toMatchObject({ note: "newer" });
  });

  it("does not send an empty ordinary background exchange", async () => {
    expect(await hasPendingChanges()).toBe(false);

    const outcome = await syncNow(OWNER, { pullRequired: false });

    expect(outcome).toMatchObject({ pushed: 0, pulled: 0 });
    expect(server.exchanges).toHaveLength(0);
  });

  it("reports a durable outbox before scheduling a request", async () => {
    await localDirtyHabit("h1", "ورزش");
    expect(await hasPendingChanges()).toBe(true);
    await syncNow(OWNER, { pullRequired: false });
    expect(await hasPendingChanges()).toBe(false);
  });

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

  it("pauses a row-cap rejection until its bounded retry instead of sending an immediate hot loop", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(5_000);
    await localDirtyTask("row-cap", "در صف ظرفیت");
    server.refuse.add("row-cap");
    server.refuseCode = "account_quota_exceeded";
    server.refuseRetryAt.set("row-cap", 10_000);

    await syncNow(OWNER);

    expect((await idb.tasks.get("row-cap"))?.dirty).toBe(2);
    expect(await hasPendingChanges(OWNER)).toBe(false);
    await syncNow(OWNER, { pullRequired: true });
    expect(server.exchanges.at(-1)?.records).toEqual([]);

    server.refuse.clear();
    now.mockReturnValue(10_000);
    await syncNow(OWNER, { pullRequired: true });
    expect(server.exchanges.at(-1)?.records).toEqual([
      expect.objectContaining({ id: "row-cap", updatedAt: 1000 }),
    ]);
  });

  it("converges duplicate same-page archive/ordinary rows by their evolving LWW state", async () => {
    await idb.habits.put({
      key: "archive-override",
      data: habitData("archive-override", "محلی قدیمی"),
      updatedAt: 500,
      deleted: 0,
      dirty: 0,
      seq: 1,
    });
    server.log.push(
      {
        kind: "habits",
        id: "archive-override",
        data: habitData("archive-override", "نسخه آرشیو جدیدتر"),
        updatedAt: 2_000,
        deleted: false,
        seq: 1,
      },
      {
        kind: "habits",
        id: "archive-override",
        data: habitData("archive-override", "نسخه عادی قدیمی‌تر"),
        updatedAt: 1_000,
        deleted: false,
        seq: 2,
      },
    );

    const outcome = await syncNow(OWNER, { pullRequired: true });

    expect(await idb.habits.get("archive-override")).toMatchObject({
      data: { name: "نسخه آرشیو جدیدتر" },
      updatedAt: 2_000,
      deleted: 0,
      dirty: 0,
    });
    expect(outcome.remoteChanged).toBe(true);
  });

  it("takes an equal remote tombstone after an ordinary same-page copy without resurrection", async () => {
    server.log.push(
      {
        kind: "habits",
        id: "equal-delete",
        data: { id: "equal-delete", name: "زنده" },
        updatedAt: 2_000,
        deleted: false,
        seq: 1,
      },
      {
        kind: "habits",
        id: "equal-delete",
        data: null,
        updatedAt: 2_000,
        deleted: true,
        seq: 2,
      },
    );

    await syncNow(OWNER, { pullRequired: true });

    expect(await idb.habits.get("equal-delete")).toMatchObject({
      data: null,
      updatedAt: 2_000,
      deleted: 1,
      dirty: 0,
    });
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

  it("keeps dirty flags when a reset response did not admit the exchange batch", async () => {
    await localDirtyHabit("stale-dirty", "نسخه محلی", 2_000);
    server.rejectNextBatchForReset = true;

    const outcome = await syncNow(OWNER);

    expect(outcome.pushed).toBe(0);
    expect(outcome.remoteChanged).toBe(true);
    expect(await idb.habits.get("stale-dirty")).toMatchObject({
      data: { id: "stale-dirty", name: "نسخه محلی" },
      updatedAt: 2_000,
      dirty: 1,
    });
    expect(server.log.some((record) => record.id === "stale-dirty")).toBe(false);
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
    await localDirtyHabit("h-local", "پیاده‌روی", 2_000);

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
    expect((await idb.table("habits").get("h-local"))?.dirty).toBe(0);
    // The refused row is kept, not discarded: it is the user's writing.
    expect((await idb.table("journal").get("2026-08-01"))?.dirty).toBe(1);
  });

  it("does not settle a newer local edit made while the exchange is in flight", async () => {
    await localDirtyHabit("h1", "نسخه ارسالی", 2_000);
    server.afterExchange = async () => {
      server.afterExchange = null;
      await idb.habits.put({
        key: "h1",
        data: habitData("h1", "نسخه جدیدتر"),
        updatedAt: 3_000,
        deleted: 0,
        dirty: 1,
        seq: 1,
      });
    };

    await syncNow(OWNER);

    expect((await idb.habits.get("h1"))?.dirty).toBe(1);
    expect((await idb.habits.get("h1"))?.data).toMatchObject({ name: "نسخه جدیدتر" });
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
      settings: { ...defaultLocal().settings, theme: "dark", notificationsEnabled: false },
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
