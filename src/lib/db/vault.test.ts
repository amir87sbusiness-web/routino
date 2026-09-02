import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { db, row } from "./dexie";
import {
  LEGACY_VAULT_ID,
  activateVault,
  databaseNameForVault,
  getActiveVaultId,
  switchOwnerVault,
} from "./vault";
import type { Habit } from "../store";
import { defaultLocal, loadLocal, saveLocal } from "./local";

const habit = (id: string, name: string): Habit => ({
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

beforeEach(async () => {
  const databases = await Dexie.getDatabaseNames();
  await Promise.all(
    databases
      .filter((name) => name === "routino" || name.startsWith("routino:vault:"))
      .map((name) => Dexie.delete(name)),
  );
  localStorage.clear();
  await activateVault(LEGACY_VAULT_ID);
});

describe("account vault lifecycle", () => {
  it("returns account A data after A -> B -> A without exposing or deleting either vault", async () => {
    const firstA = await switchOwnerVault("user-a");
    expect(firstA.claimedCurrent).toBe(true);
    await db.habits.put(row("habit-a", habit("habit-a", "A")));

    const firstB = await switchOwnerVault("user-b");
    expect(firstB.changed).toBe(true);
    expect(await db.habits.get("habit-a")).toBeUndefined();
    await db.habits.put(row("habit-b", habit("habit-b", "B")));

    await switchOwnerVault("user-a");
    expect((await db.habits.get("habit-a"))?.data?.name).toBe("A");
    expect(await db.habits.get("habit-b")).toBeUndefined();

    await switchOwnerVault("user-b");
    expect((await db.habits.get("habit-b"))?.data?.name).toBe("B");
    expect(await db.habits.get("habit-a")).toBeUndefined();
  });

  it("reuses the same vault for relogin to one account", async () => {
    const first = await switchOwnerVault("user-a");
    const second = await switchOwnerVault("user-a");
    expect(second.vaultId).toBe(first.vaultId);
    expect(second.changed).toBe(false);
  });

  it("gives a recreated account with the same phone a new empty onboarding vault", async () => {
    await switchOwnerVault("deleted-user-id");
    const old = defaultLocal();
    old.settings.onboarded = true;
    old.auth = {
      userId: "deleted-user-id",
      phone: "989123334444",
      verifiedAt: 1,
    };
    saveLocal(old);
    await db.habits.put(row("old-habit", habit("old-habit", "Old account")));

    const recreated = await switchOwnerVault("new-user-id");
    const fresh = loadLocal();

    expect(recreated.changed).toBe(true);
    expect(fresh.settings.onboarded).toBe(false);
    expect(fresh.auth).toBeNull();
    expect(await db.habits.get("old-habit")).toBeUndefined();
  });

  it("keeps the legacy database name when the first account claims existing data", async () => {
    await db.habits.put(row("legacy-habit", habit("legacy-habit", "Legacy")));
    const claimed = await switchOwnerVault("user-a");
    expect(claimed.vaultId).toBe(LEGACY_VAULT_ID);
    expect(databaseNameForVault(claimed.vaultId)).toBe("routino");
    expect(getActiveVaultId()).toBe(LEGACY_VAULT_ID);
    expect((await db.habits.get("legacy-habit"))?.data?.name).toBe("Legacy");
  });

  it("does not let a different first account claim a legacy vault known to belong to another phone", async () => {
    await db.habits.put(row("legacy-habit", habit("legacy-habit", "A")));

    const assigned = await switchOwnerVault("user-b", { claimCurrent: false });

    expect(assigned.vaultId).not.toBe(LEGACY_VAULT_ID);
    expect(assigned.claimedCurrent).toBe(false);
    expect(await db.habits.get("legacy-habit")).toBeUndefined();
    await activateVault(LEGACY_VAULT_ID);
    expect((await db.habits.get("legacy-habit"))?.data?.name).toBe("A");
  });

  it("isolates device-local auth, subscription and notifications with the vault", async () => {
    await switchOwnerVault("user-a");
    saveLocal({
      ...defaultLocal(),
      auth: { userId: "user-a", phone: "989111111111", verifiedAt: 1 },
      notifications: [{ id: "a", title: "A", body: "A", at: 1, read: false }],
    });

    await switchOwnerVault("user-b");
    expect(loadLocal().auth).toBeNull();
    expect(loadLocal().notifications).toEqual([]);
    saveLocal({
      ...defaultLocal(),
      auth: { userId: "user-b", phone: "989222222222", verifiedAt: 2 },
      notifications: [{ id: "b", title: "B", body: "B", at: 2, read: false }],
    });

    await switchOwnerVault("user-a");
    expect(loadLocal().auth?.phone).toBe("989111111111");
    expect(loadLocal().notifications.map((item) => item.id)).toEqual(["a"]);
  });
});
