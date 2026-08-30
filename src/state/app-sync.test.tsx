import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDb, type Db, type Habit } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  applyChanges: vi.fn(),
  fetchEntitlement: vi.fn(),
  hasPendingChanges: vi.fn(),
  hydrate: vi.fn(),
  importSubscription: vi.fn(),
  markEntitlementChecked: vi.fn(),
  reconcileNativeReminders: vi.fn(),
  requestNativePermission: vi.fn(),
  saveLocal: vi.fn(),
  sessionUserId: vi.fn(() => "user-1" as string | null),
  switchOwnerVault: vi.fn(),
  syncNow: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  clearTokens: vi.fn(),
  entitlementToSubscription: vi.fn(
    (entitlement: { status: string; planId: string | null; expiresAt: string | null }) =>
      entitlement.status === "none" || !entitlement.expiresAt
        ? null
        : {
            planId: entitlement.planId ?? "unknown",
            startedAt: 1,
            expiresAt: Date.parse(entitlement.expiresAt),
            trial: entitlement.planId === "trial",
          },
  ),
  fetchEntitlement: mocks.fetchEntitlement,
  hasSession: vi.fn(() => true),
  importSubscription: mocks.importSubscription,
  loadTokens: vi.fn(() => ({
    access: "access",
    accessExpiresAt: Date.now() + 60_000,
    lastEntitlementCheckedAt: Date.now(),
  })),
  markEntitlementChecked: mocks.markEntitlementChecked,
  sessionUserId: mocks.sessionUserId,
}));
vi.mock("@/lib/db/hydrate", () => ({ hydrate: mocks.hydrate }));
vi.mock("@/lib/db/persist", () => ({ applyChanges: mocks.applyChanges }));
vi.mock("@/lib/db/local", () => ({
  loadLocal: vi.fn(() => ({})),
  localChanged: vi.fn(() => false),
  saveLocal: mocks.saveLocal,
  toLocalState: vi.fn((db: Db) => db),
}));
vi.mock("@/lib/db/vault", () => ({ switchOwnerVault: mocks.switchOwnerVault }));
vi.mock("@/lib/native", () => ({ syncNativeBars: vi.fn() }));
vi.mock("@/lib/native-notifications", () => ({
  isNativeRuntime: vi.fn(() => true),
  reconcileNativeReminders: mocks.reconcileNativeReminders,
  requestNativePermission: mocks.requestNativePermission,
}));
vi.mock("@/lib/sync/engine", () => ({
  hasPendingChanges: mocks.hasPendingChanges,
  syncNow: mocks.syncNow,
}));

import { AppProvider, useAppMaybe } from "./app";

const habit = (id: string, name = id): Habit => ({
  id,
  name,
  categoryId: "general",
  type: "binary",
  target: 1,
  schedule: { kind: "daily" },
  monthlyGoal: null,
  reminderTime: null,
  createdAt: 1,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("AppProvider sync lifecycle", () => {
  let host: HTMLDivElement;
  let root: Root;
  let app: NonNullable<ReturnType<typeof useAppMaybe>> | null;
  let initial: Db;

  function Probe() {
    app = useAppMaybe();
    return null;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    app = null;
    initial = {
      ...defaultDb([]),
      settings: { ...defaultDb([]).settings, notificationsEnabled: true },
      auth: { userId: "user-1", phone: "989123334444", verifiedAt: Date.now() },
      subscription: {
        planId: "trial",
        startedAt: Date.now() - 1_000,
        expiresAt: Date.now() + 86_400_000,
        trial: true,
      },
      meta: { ...defaultDb([]).meta, legacyEntitlementMigrationResolved: true },
    };
    mocks.applyChanges.mockReset().mockResolvedValue(undefined);
    mocks.fetchEntitlement.mockReset().mockResolvedValue({ entitlement: { status: "none" } });
    mocks.hasPendingChanges.mockReset().mockResolvedValue(false);
    mocks.hydrate.mockReset().mockResolvedValue({ db: initial, local: {}, migrated: false });
    mocks.importSubscription.mockReset();
    mocks.markEntitlementChecked.mockReset();
    mocks.reconcileNativeReminders
      .mockReset()
      .mockResolvedValue({ status: "scheduled", scheduled: 0 });
    mocks.requestNativePermission.mockReset().mockResolvedValue(true);
    mocks.saveLocal.mockReset();
    mocks.sessionUserId.mockReset().mockReturnValue("user-1");
    mocks.switchOwnerVault.mockReset().mockResolvedValue({
      vaultId: "vault",
      changed: true,
      claimedCurrent: false,
    });
    mocks.syncNow.mockReset().mockResolvedValue({
      pushed: 0,
      pulled: 0,
      rejected: 0,
      remoteChanged: false,
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <AppProvider>
          <Probe />
        </AppProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("starts the existing engine with canonical userId after authenticated boot", () => {
    expect(mocks.syncNow).toHaveBeenCalledWith("user-1", {
      includeAccountState: true,
      pullRequired: true,
    });
  });

  it("reconciles native reminders on boot without requesting OS permission", () => {
    expect(mocks.reconcileNativeReminders).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.objectContaining({ userId: "user-1" }) }),
      expect.objectContaining({
        productRemindersAllowed: true,
        lifecycleRemindersAllowed: true,
      }),
    );
    expect(mocks.requestNativePermission).not.toHaveBeenCalled();
  });

  it("cancels product reminders at expiry but keeps lifecycle reminders and restores them after payment", async () => {
    mocks.reconcileNativeReminders.mockClear();

    await act(async () =>
      app!.applyEntitlement({
        planId: "trial",
        startedAt: Date.now() - 8 * 86_400_000,
        expiresAt: Date.now() - 1,
        trial: true,
      }),
    );
    await settle();
    expect(mocks.reconcileNativeReminders).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        productRemindersAllowed: false,
        lifecycleRemindersAllowed: true,
      }),
    );

    await act(async () =>
      app!.applyEntitlement({
        planId: "m3",
        startedAt: Date.now(),
        expiresAt: Date.now() + 90 * 86_400_000,
        trial: false,
      }),
    );
    await settle();
    expect(mocks.reconcileNativeReminders).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        productRemindersAllowed: true,
        lifecycleRemindersAllowed: true,
      }),
    );
  });

  it("continues authenticated sync while access is expired", async () => {
    await act(async () =>
      app!.applyEntitlement({
        planId: "m1",
        startedAt: Date.now() - 40 * 86_400_000,
        expiresAt: Date.now() - 1,
        trial: false,
      }),
    );
    mocks.syncNow.mockClear();
    mocks.hasPendingChanges.mockResolvedValue(true);

    window.dispatchEvent(new Event("online"));
    await settle();

    expect(mocks.syncNow).toHaveBeenCalledWith("user-1", { pullRequired: false });
  });

  it("boots a fresh expired vault with restored history, sync enabled, and writes locked", async () => {
    await act(async () => root.unmount());
    app = null;
    initial = {
      ...initial,
      habits: [habit("cloud-history")],
      subscription: {
        planId: "m1",
        startedAt: Date.now() - 40 * 86_400_000,
        expiresAt: Date.now() - 1,
        trial: false,
      },
    };
    mocks.hydrate.mockResolvedValueOnce({ db: initial, local: {}, migrated: false });
    mocks.syncNow.mockClear();
    root = createRoot(host);

    await act(async () => {
      root.render(
        <AppProvider>
          <Probe />
        </AppProvider>,
      );
      await Promise.resolve();
    });
    await settle();

    expect(app!.db?.habits.map((item) => item.id)).toContain("cloud-history");
    expect(mocks.syncNow).toHaveBeenCalledWith("user-1", {
      includeAccountState: true,
      pullRequired: true,
    });
    expect(app!.update((db) => ({ ...db, habits: [...db.habits, habit("blocked")] }))).toBe(false);
  });

  it("drains a product write accepted before expiry after persistence finishes", async () => {
    mocks.syncNow.mockClear();
    const write = deferred<void>();
    mocks.applyChanges.mockReturnValueOnce(write.promise);

    await act(async () => {
      app!.update((db) => ({ ...db, habits: [...db.habits, habit("before-expiry")] }));
      await Promise.resolve();
    });
    await act(async () =>
      app!.applyEntitlement({
        planId: "trial",
        startedAt: Date.now() - 7 * 86_400_000,
        expiresAt: Date.now() - 1,
        trial: true,
      }),
    );
    write.resolve();
    await settle();
    await act(async () => vi.advanceTimersByTime(10_000));
    await settle();

    expect(mocks.syncNow).toHaveBeenCalledWith("user-1", { pullRequired: false });
  });

  it("reconciles task changes and foreground without action-specific scheduling", async () => {
    mocks.reconcileNativeReminders.mockClear();

    await act(async () => {
      app!.update((db) => ({
        ...db,
        tasks: [
          ...db.tasks,
          {
            id: "remote-task",
            dateKey: "2026-08-22",
            title: "Synced task",
            type: "binary",
            target: 1,
            value: 0,
            done: false,
            reminderAt: "2026-08-22T08:00",
          },
        ],
      }));
      await Promise.resolve();
    });
    await settle();

    expect(mocks.reconcileNativeReminders).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileNativeReminders).toHaveBeenLastCalledWith(
      expect.objectContaining({ tasks: [expect.objectContaining({ id: "remote-task" })] }),
      expect.any(Object),
    );

    mocks.reconcileNativeReminders.mockClear();
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(mocks.reconcileNativeReminders).toHaveBeenCalledTimes(1);
  });

  it("waits for IndexedDB persistence and debounces quick local mutations", async () => {
    mocks.syncNow.mockClear();
    const write = deferred<void>();
    mocks.applyChanges.mockReturnValueOnce(write.promise);

    await act(async () => {
      app!.update((db) => ({ ...db, habits: [...db.habits, habit("h1")] }));
      await Promise.resolve();
    });

    expect(mocks.applyChanges).toHaveBeenCalledTimes(1);
    expect(mocks.syncNow).not.toHaveBeenCalled();

    write.resolve();
    await settle();
    expect(mocks.syncNow).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(10_000));
    await settle();
    expect(mocks.syncNow).toHaveBeenCalledTimes(1);
    expect(mocks.syncNow).toHaveBeenCalledWith("user-1", { pullRequired: false });
  });

  it("persists a first habit through the normal local-first sync path", async () => {
    mocks.applyChanges.mockClear();
    mocks.syncNow.mockClear();

    await act(async () => {
      app!.update((db) => ({ ...db, habits: [...db.habits, habit("first-habit", "First habit")] }));
      await Promise.resolve();
    });
    await settle();

    expect(app!.db?.habits).toEqual([expect.objectContaining({ id: "first-habit" })]);
    expect(mocks.applyChanges).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(10_000));
    await settle();
    expect(mocks.syncNow).toHaveBeenCalledWith("user-1", { pullRequired: false });
  });

  it("allows normal product mutations during an active trial", async () => {
    let applied = false;

    const accepted = app!.update((db) => {
      applied = true;
      return { ...db, habits: [...db.habits, habit("trial-habit")] };
    });
    await settle();

    expect(accepted).toBe(true);
    expect(applied).toBe(true);
    expect(app!.db?.habits.map((item) => item.id)).toContain("trial-habit");
  });

  it("blocks every product collection mutation after expiry without invoking the updater", async () => {
    const expired = {
      planId: "trial",
      startedAt: Date.now() - 8 * 86_400_000,
      expiresAt: Date.now() - 1,
      trial: true,
    };
    await act(async () => app!.applyEntitlement(expired));
    const before = app!.db;
    let calls = 0;

    const attempts = [
      (db: Db) => ({ ...db, habits: [...db.habits, habit("blocked-create")] }),
      (db: Db) => ({
        ...db,
        logs: {
          ...db.logs,
          "h|2026-08-21": { habitId: "h", dateKey: "2026-08-21", value: 1, done: true },
        },
      }),
      (db: Db) => ({
        ...db,
        tasks: [
          ...db.tasks,
          {
            id: "t",
            dateKey: "2026-08-21",
            title: "Blocked",
            type: "binary" as const,
            target: 1,
            value: 0,
            done: false,
          },
        ],
      }),
      (db: Db) => ({
        ...db,
        journal: {
          ...db.journal,
          "2026-08-21": {
            dateKey: "2026-08-21",
            text: "Blocked",
            score: null,
            mood: null,
            updatedAt: 1,
          },
        },
      }),
      (db: Db) => ({
        ...db,
        timerSessions: [
          ...db.timerSessions,
          { id: "s", mode: "free" as const, focusSeconds: 60, startedAt: 1, endedAt: 61 },
        ],
      }),
    ];
    for (const attempt of attempts) {
      const accepted = app!.update((db) => {
        calls += 1;
        return attempt(db);
      });
      expect(accepted).toBe(false);
    }
    await settle();

    expect(calls).toBe(0);
    expect(app!.db).toBe(before);
    expect(app!.writeBlocked).toBe(true);
  });

  it("allows audited preferences, logout, and synced-content reset after expiry", async () => {
    await act(async () => {
      app!.update((db) => ({ ...db, habits: [...db.habits, habit("reset-me")] }));
    });
    await settle();
    await act(async () =>
      app!.applyEntitlement({
        planId: "m1",
        startedAt: Date.now() - 40 * 86_400_000,
        expiresAt: Date.now() - 1,
        trial: false,
      }),
    );
    await act(async () => {
      app!.updatePreferences({ theme: "dark", lang: "en" });
    });
    expect(app!.db?.settings).toMatchObject({ theme: "dark", lang: "en" });

    mocks.applyChanges.mockClear();
    await act(async () => app!.resetSyncedContent());
    await settle();
    expect(app!.db?.habits).toEqual([]);
    expect(app!.db?.subscription?.planId).toBe("m1");
    expect(mocks.applyChanges).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ table: "habits", key: "reset-me", deleted: true }),
      ]),
    );

    await act(async () => app!.signOutLocal());
    expect(app!.db?.auth).toBeNull();
  });

  it("restores product writes immediately from an authoritative paid entitlement", async () => {
    await act(async () =>
      app!.applyEntitlement({
        planId: "trial",
        startedAt: 1,
        expiresAt: Date.now() - 1,
        trial: true,
      }),
    );
    expect(app!.update((db) => ({ ...db, habits: [...db.habits, habit("blocked")] }))).toBe(false);

    await act(async () =>
      app!.applyEntitlement({
        planId: "m3",
        startedAt: Date.now(),
        expiresAt: Date.now() + 90 * 86_400_000,
        trial: false,
      }),
    );
    expect(app!.update((db) => ({ ...db, habits: [...db.habits, habit("unlocked")] }))).toBe(true);
    await settle();

    expect(app!.db?.habits.map((item) => item.id)).toContain("unlocked");
  });

  it("marks sync entitlement checked and avoids an immediate duplicate entitlement request", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    mocks.markEntitlementChecked.mockClear();
    mocks.fetchEntitlement.mockClear();
    mocks.syncNow.mockClear().mockResolvedValue({
      pushed: 0,
      pulled: 0,
      rejected: 0,
      remoteChanged: false,
      entitlement: {
        status: "active",
        planId: "m1",
        expiresAt,
        issuedAt: new Date().toISOString(),
      },
    });
    mocks.hasPendingChanges.mockResolvedValue(true);

    window.dispatchEvent(new Event("online"));
    await settle();

    expect(mocks.markEntitlementChecked).toHaveBeenCalledTimes(1);
    expect(mocks.fetchEntitlement).not.toHaveBeenCalled();
    expect(app!.db?.subscription?.expiresAt).toBe(Date.parse(expiresAt));
  });

  it("syncs on lifecycle events without any visible polling interval", async () => {
    mocks.syncNow.mockClear();
    mocks.hasPendingChanges.mockResolvedValue(true);

    await act(async () => vi.advanceTimersByTime(10 * 60_000));
    await settle();
    expect(mocks.syncNow).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("online"));
    await settle();
    expect(mocks.syncNow).toHaveBeenCalledTimes(1);
    expect(mocks.syncNow).toHaveBeenCalledWith("user-1", { pullRequired: false });

    mocks.syncNow.mockClear();
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(mocks.syncNow).toHaveBeenCalledTimes(1);
    expect(mocks.syncNow).toHaveBeenCalledWith("user-1", { pullRequired: true });

    mocks.syncNow.mockClear();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(mocks.syncNow).toHaveBeenCalledWith("user-1", {
      keepalive: true,
      pullRequired: false,
    });
  });

  it("selects and hydrates the new vault before syncing the new account", async () => {
    mocks.syncNow.mockClear();
    const emptyB = defaultDb([]);
    mocks.hydrate.mockResolvedValueOnce({ db: emptyB, local: {}, migrated: false });

    await act(async () => {
      await app!.switchAccount(
        { id: "user-b", phone: "989122222222" },
        {
          status: "active",
          planId: "m1",
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
          issuedAt: new Date().toISOString(),
        },
      );
    });
    await settle();

    expect(mocks.switchOwnerVault).toHaveBeenCalledWith("user-b", { claimCurrent: false });
    expect(app!.db?.auth?.userId).toBe("user-b");
    expect(mocks.syncNow).toHaveBeenCalledWith("user-b", {
      includeAccountState: true,
      pullRequired: true,
    });
    expect(mocks.hydrate.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.syncNow.mock.invocationCallOrder.at(-1)!,
    );

    await act(async () => vi.advanceTimersByTime(2_000));
    await settle();
    expect(mocks.syncNow).toHaveBeenLastCalledWith("user-b", { pullRequired: true });
  });

  it("preserves an unresolved legacy plan on import failure and retries on a later server answer", async () => {
    mocks.syncNow.mockClear();
    const legacyDb: Db = {
      ...defaultDb([]),
      subscription: {
        planId: "legacy",
        startedAt: Date.now() - 86_400_000,
        expiresAt: Date.now() + 30 * 86_400_000,
        trial: false,
      },
    };
    mocks.hydrate.mockResolvedValueOnce({ db: legacyDb, local: {}, migrated: false });
    mocks.importSubscription.mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      await app!.switchAccount(
        { id: "legacy-user", phone: "989122222222" },
        { status: "none", planId: null, expiresAt: null, issuedAt: new Date().toISOString() },
      );
    });
    await settle();

    expect(mocks.importSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.importSubscription).toHaveBeenCalledWith(legacyDb.subscription, "legacy-user");
    expect(mocks.hydrate.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.importSubscription.mock.invocationCallOrder[0]!,
    );
    expect(app!.db?.subscription?.planId).toBe("legacy");
    expect(app!.db?.meta.legacyEntitlementMigrationResolved).toBe(false);

    const expiresAt = new Date(Date.now() + 60 * 86_400_000).toISOString();
    mocks.importSubscription.mockResolvedValueOnce({
      imported: true,
      entitlement: {
        status: "active",
        planId: "m3",
        expiresAt,
        issuedAt: new Date().toISOString(),
      },
    });
    mocks.syncNow.mockResolvedValueOnce({
      pushed: 0,
      pulled: 0,
      rejected: 0,
      remoteChanged: false,
      entitlement: {
        status: "none",
        planId: null,
        expiresAt: null,
        issuedAt: new Date().toISOString(),
      },
    });
    mocks.hasPendingChanges.mockResolvedValue(true);

    window.dispatchEvent(new Event("online"));
    await settle();

    expect(mocks.importSubscription).toHaveBeenCalledTimes(2);
    expect(app!.db?.subscription?.planId).toBe("m3");
    expect(app!.db?.meta.legacyEntitlementMigrationResolved).toBe(true);
  });

  it("does not import a legacy plan owned by a different phone into the new account", async () => {
    const otherOwnerDb: Db = {
      ...defaultDb([]),
      auth: { userId: "user-a", phone: "989111111111", verifiedAt: Date.now() },
      subscription: {
        planId: "legacy-a",
        startedAt: Date.now() - 86_400_000,
        expiresAt: Date.now() + 30 * 86_400_000,
        trial: false,
      },
      meta: { ...defaultDb([]).meta, dataOwner: "989111111111" },
    };
    mocks.hydrate.mockResolvedValueOnce({ db: otherOwnerDb, local: {}, migrated: false });

    await act(async () => {
      await app!.switchAccount(
        { id: "user-b", phone: "989122222222" },
        { status: "none", planId: null, expiresAt: null, issuedAt: new Date().toISOString() },
      );
    });
    await settle();

    expect(mocks.importSubscription).not.toHaveBeenCalled();
    expect(app!.db?.subscription).toBeNull();
    expect(app!.db?.meta.legacyEntitlementMigrationResolved).toBe(true);
  });

  it("does not allow a different first account to claim the current legacy vault", async () => {
    await act(async () => {
      app!.update((db) => ({
        ...db,
        auth: { userId: "user-a", phone: "989111111111", verifiedAt: Date.now() },
        meta: { ...db.meta, dataOwner: "989111111111" },
      }));
    });
    mocks.hydrate.mockResolvedValueOnce({ db: defaultDb([]), local: {}, migrated: false });

    await act(async () => {
      await app!.switchAccount(
        { id: "user-b", phone: "989122222222" },
        { status: "none", planId: null, expiresAt: null, issuedAt: new Date().toISOString() },
      );
    });

    expect(mocks.switchOwnerVault).toHaveBeenCalledWith("user-b", { claimCurrent: false });
  });

  it("applies sync none authoritatively after migration resolution", async () => {
    await act(async () => {
      app!.update((db) => ({
        ...db,
        subscription: {
          planId: "stale",
          startedAt: 1,
          expiresAt: Date.now() + 86_400_000,
          trial: false,
        },
        meta: {
          ...db.meta,
          tampered: true,
          legacyEntitlementMigrationResolved: true,
        },
      }));
    });
    await settle();
    mocks.syncNow.mockClear().mockResolvedValueOnce({
      pushed: 0,
      pulled: 0,
      rejected: 0,
      remoteChanged: false,
      entitlement: {
        status: "none",
        planId: null,
        expiresAt: null,
        issuedAt: new Date().toISOString(),
      },
    });
    mocks.hasPendingChanges.mockResolvedValue(true);

    window.dispatchEvent(new Event("online"));
    await settle();

    expect(app!.db?.subscription).toBeNull();
    expect(app!.db?.meta.tampered).toBe(false);
  });

  it("preserves edits made during sync and during remote hydration", async () => {
    mocks.syncNow.mockClear();
    const network = deferred<{
      pushed: number;
      pulled: number;
      rejected: number;
      remoteChanged: boolean;
    }>();
    mocks.syncNow.mockReturnValueOnce(network.promise);

    await act(async () => {
      app!.update((db) => ({ ...db, habits: [...db.habits, habit("local-during-sync")] }));
      await Promise.resolve();
    });
    await settle();
    await act(async () => vi.advanceTimersByTime(10_000));
    await settle();
    expect(mocks.syncNow).toHaveBeenCalledTimes(1);

    const candidateHydrate = deferred<{ db: Db; local: object; migrated: boolean }>();
    const candidate: Db = {
      ...initial,
      habits: [habit("remote"), habit("local-during-sync")],
    };
    const final: Db = {
      ...initial,
      habits: [habit("remote"), habit("local-during-sync"), habit("local-during-hydrate")],
    };
    mocks.hydrate
      .mockImplementationOnce(() => candidateHydrate.promise)
      .mockResolvedValueOnce({ db: final, local: {}, migrated: false });

    network.resolve({ pushed: 1, pulled: 1, rejected: 0, remoteChanged: true });
    await settle();
    expect(mocks.hydrate).toHaveBeenCalledTimes(2);

    await act(async () => {
      app!.update((db) => ({ ...db, habits: [...db.habits, habit("local-during-hydrate")] }));
      await Promise.resolve();
    });
    await settle();

    candidateHydrate.resolve({ db: candidate, local: {}, migrated: false });
    await settle();
    await act(async () => vi.advanceTimersByTime(1));
    await settle();

    expect(mocks.hydrate).toHaveBeenCalledTimes(3);
    expect(app!.db?.habits.map((item) => item.id).sort()).toEqual([
      "local-during-hydrate",
      "local-during-sync",
      "remote",
    ]);
  });
});
