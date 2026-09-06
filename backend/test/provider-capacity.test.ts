import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/db/client.js";
import { acquireProviderLease, releaseProviderLease } from "../src/services/provider-capacity.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

describe("provider capacity leases", () => {
  it("never admits more live work than the configured capacity", async () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const leases = await Promise.all(
      Array.from({ length: 32 }, () => acquireProviderLease(h.db, "sms", 32, now, 30_000)),
    );

    expect(leases.filter(Boolean)).toHaveLength(32);
    expect(await acquireProviderLease(h.db, "sms", 32, now, 30_000)).toBeNull();
    const [row] = await h.query<{ n: number }>(
      `select count(*)::int as n from provider_capacity_leases where kind = 'sms' and expires_at > '2026-09-05T12:00:00.000Z'`,
    );
    expect(Number(row!.n)).toBe(32);
  });

  it("reuses released and expired crash leases", async () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const first = await acquireProviderLease(h.db, "sms", 1, now, 30_000);
    expect(first).not.toBeNull();
    expect(await acquireProviderLease(h.db, "sms", 1, now, 30_000)).toBeNull();

    await releaseProviderLease(h.db, "sms", first!.leaseId);
    const replacement = await acquireProviderLease(h.db, "sms", 1, now, 30_000);
    expect(replacement).not.toBeNull();

    const afterCrashExpiry = new Date(now.getTime() + 30_001);
    expect(await acquireProviderLease(h.db, "sms", 1, afterCrashExpiry, 30_000)).not.toBeNull();
    const [row] = await h.query<{ n: number }>(
      `select count(*)::int as n from provider_capacity_leases where kind = 'sms'`,
    );
    expect(Number(row!.n)).toBe(1);
  });

  it("does not mask a completed provider call when lease cleanup fails", async () => {
    const cleanupError = new Error("temporary database cleanup failure");
    const failingDb = {
      delete: () => ({
        where: async () => {
          throw cleanupError;
        },
      }),
    } as unknown as Database;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      releaseProviderLease(failingDb, "psp", crypto.randomUUID()),
    ).resolves.toBeUndefined();

    logged.mockRestore();
  });
});
