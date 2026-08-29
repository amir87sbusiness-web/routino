import { describe, expect, it } from "vitest";
import type { RecordRow } from "../db/dexie";
import type { RemoteRecord } from "../api/sync";
import { acceptsRemote, mergeRemote } from "./merge";

const local = (updatedAt: number, over: Partial<RecordRow<unknown>> = {}): RecordRow<unknown> => ({
  key: "h1",
  data: { name: "محلی" },
  updatedAt,
  deleted: 0,
  dirty: 0,
  seq: 7,
  ...over,
});

const remote = (updatedAt: number, over: Partial<RemoteRecord> = {}): RemoteRecord => ({
  kind: "habits",
  id: "h1",
  data: { name: "از سرور" },
  updatedAt,
  deleted: false,
  seq: 100,
  ...over,
});

// Deterministic allocator, so "did this row get a NEW seq" is observable.
const alloc = () => 999;

describe("mergeRemote — last write wins", () => {
  it("takes the remote copy when it is newer", () => {
    const row = mergeRemote(local(1000), remote(2000), alloc);
    expect(row?.data).toEqual({ name: "از سرور" });
  });

  it("keeps the local copy when it is newer", () => {
    // The user edited on this device while offline; a stale server copy must not
    // undo it in front of them.
    expect(mergeRemote(local(2000), remote(1000), alloc)).toBeNull();
  });

  it("keeps the local copy on an exact tie", () => {
    // Same millisecond means the two devices agree anyway. Preferring local
    // stops a device replaying its outbox from rewriting rows it already has.
    expect(mergeRemote(local(1000), remote(1000), alloc)).toBeNull();
  });

  it("accepts anything for a record this device has never seen", () => {
    expect(mergeRemote(undefined, remote(1), alloc)).not.toBeNull();
  });
});

describe("mergeRemote — bookkeeping", () => {
  it("never marks an applied record dirty", () => {
    // A record that came FROM the server is already on it. Marking it dirty
    // would push it straight back, bump its seq, and wake every other device
    // for a change that never happened.
    expect(mergeRemote(undefined, remote(1), alloc)?.dirty).toBe(0);
    expect(mergeRemote(local(1), remote(2), alloc)?.dirty).toBe(0);
  });

  it("preserves the local display order of a record it overwrites", () => {
    // `seq` is presentation order, not sync state. Re-allocating it would
    // reshuffle the user's habit list every time they synced.
    expect(mergeRemote(local(1000, { seq: 7 }), remote(2000), alloc)?.seq).toBe(7);
  });

  it("allocates a display position for a brand-new record", () => {
    expect(mergeRemote(undefined, remote(1), alloc)?.seq).toBe(999);
  });

  it("applies a tombstone as a row, not a deletion", () => {
    const row = mergeRemote(local(1000), remote(2000, { deleted: true, data: null }), alloc);
    expect(row?.deleted).toBe(1);
    expect(row?.data).toBeNull();
    // Still a row: an absence could never travel to a third device.
    expect(row?.key).toBe("h1");
  });
});

describe("acceptsRemote — what is allowed to arrive at all", () => {
  it("refuses every setting, including formerly account-level settings", () => {
    for (const id of ["lang", "calendar", "brandColor", "onboarded", "journalReminder"]) {
      expect(acceptsRemote(remote(1, { kind: "settings", id }))).toBe(false);
    }
  });

  it("refuses device-local settings even if the server offers them", () => {
    // `theme` is per-device on purpose (phone at night vs laptop in daylight),
    // and pulling `notificationsEnabled: true` would fire an unprompted OS
    // permission dialog on a device the other one cannot grant for. This is the
    // boundary where such a row would arrive, so it is refused here rather than
    // assumed impossible upstream.
    expect(acceptsRemote(remote(1, { kind: "settings", id: "theme" }))).toBe(false);
    expect(acceptsRemote(remote(1, { kind: "settings", id: "notificationsEnabled" }))).toBe(false);
  });

  it("refuses kinds the server should never send", () => {
    // `feedback` is a real local table but is push-only and not a server kind;
    // anything else is simply not ours.
    expect(acceptsRemote(remote(1, { kind: "feedback" }))).toBe(false);
    expect(acceptsRemote(remote(1, { kind: "passwords" }))).toBe(false);
  });

  it("drops a refused record instead of writing it", () => {
    expect(
      mergeRemote(undefined, remote(9999, { kind: "settings", id: "theme" }), alloc),
    ).toBeNull();
  });
});
