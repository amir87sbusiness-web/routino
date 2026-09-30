import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { RoutinoDexie } from "./dexie";

const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe("RoutinoDexie upgrades", () => {
  it("keeps product rows and resets the sync cursor when goals support is added", async () => {
    const name = `routino-goals-upgrade-${crypto.randomUUID()}`;
    databaseNames.push(name);

    const legacy = new Dexie(name);
    legacy.version(1).stores({
      categories: "key, dirty, seq",
      habits: "key, dirty, seq",
      logs: "key, dirty, seq",
      tasks: "key, dirty, seq",
      timerSessions: "key, dirty, seq",
      journal: "key, dirty, seq",
      settings: "key, dirty, seq",
      feedback: "key, dirty, seq",
    });
    legacy.version(2).stores({ syncMeta: "key" });
    legacy.version(3).stores({ settings: null });
    await legacy.open();
    await legacy.table("habits").put({
      key: "h1",
      data: { id: "h1", name: "Read" },
      updatedAt: 10,
      deleted: 0,
      dirty: 0,
      seq: 1,
    });
    await legacy.table("syncMeta").put({
      key: "cursor",
      owner: "user-1",
      cursor: 123,
      lastSyncedAt: 456,
      fullResyncGcSeq: 100,
    });
    legacy.close();

    const upgraded = new RoutinoDexie(name);
    await upgraded.open();

    expect(await upgraded.habits.get("h1")).toMatchObject({ key: "h1", dirty: 0 });
    expect(await upgraded.syncMeta.get("cursor")).toEqual({
      key: "cursor",
      owner: "user-1",
      cursor: 0,
      lastSyncedAt: 0,
    });
    expect(upgraded.goals).toBeDefined();
    upgraded.close();
  });
});
