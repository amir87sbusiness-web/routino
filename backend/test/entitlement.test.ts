import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  grantInterval,
  hasSettledGrant,
  listGrants,
  readEntitlement,
  startTrialOnce,
} from "../src/services/entitlement.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
const USER = "44444444-4444-4444-4444-444444444444";

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  await h.raw(`insert into users (id, phone) values ('${USER}', '989123334444')`);
});
afterAll(async () => {
  await h?.close();
});

const days = (from: Date, to: string) => (Date.parse(to) - from.getTime()) / 86_400_000;

describe("grantInterval", () => {
  it("reports no entitlement for a fresh account", async () => {
    expect(await readEntitlement(h.db, USER, new Date())).toMatchObject({
      status: "none",
      expiresAt: null,
    });
  });

  it("stacks concurrent grants instead of overwriting one", async () => {
    // Regression: grantInterval used to SELECT the current expiry, add the
    // interval in JS, then UPDATE. Two grants landing together both read the
    // same "before" and the second write discarded the first — a user who paid
    // for two months received one. Reproduced exactly like this.
    const now = new Date("2026-07-15T00:00:00Z");
    await Promise.all([
      grantInterval(h.db, USER, { planId: "m1", months: 1, source: "payment" }, now),
      grantInterval(h.db, USER, { planId: "m1", months: 1, source: "payment" }, now),
    ]);
    const e = await readEntitlement(h.db, USER, now);
    expect(e.expiresAt).toBe("2026-09-15T00:00:00.000Z"); // both months, not one
    expect(await listGrants(h.db, USER)).toHaveLength(2);
  });

  it("keeps the ledger and the live expiry in agreement under concurrency", async () => {
    const now = new Date("2026-07-15T00:00:00Z");
    await Promise.all(
      Array.from({ length: 5 }, () =>
        grantInterval(h.db, USER, { planId: "m1", days: 10, source: "payment" }, now),
      ),
    );
    const e = await readEntitlement(h.db, USER, now);
    const ledger = await listGrants(h.db, USER);
    const totalDays = ledger.reduce((n, g) => n + g.days, 0);
    expect(totalDays).toBe(50);
    expect(days(now, e.expiresAt!)).toBe(50);
  });

  it("grants days", async () => {
    const now = new Date("2026-07-15T00:00:00Z");
    const e = await grantInterval(h.db, USER, { planId: "trial", days: 7, source: "trial" }, now);
    expect(e.status).toBe("active");
    expect(e.expiresAt).toBe("2026-07-22T00:00:00.000Z");
  });

  it("uses real calendar months, not 30-day approximations", async () => {
    // The old client did `months * 30 * 86400000`, so "1 Year" delivered 360
    // days. A year must be a year.
    const now = new Date("2026-01-15T00:00:00Z");
    const e = await grantInterval(
      h.db,
      USER,
      { planId: "m12", months: 12, source: "payment" },
      now,
    );
    expect(e.expiresAt).toBe("2027-01-15T00:00:00.000Z");
    expect(days(now, e.expiresAt!)).toBe(365);
  });

  it("clamps a month-end date instead of rolling into the next month", async () => {
    // 31 Jan + 1 month is 28 Feb in Postgres. JS's setMonth would say 3 March.
    const now = new Date("2026-01-31T00:00:00Z");
    const e = await grantInterval(h.db, USER, { planId: "m1", months: 1, source: "payment" }, now);
    expect(e.expiresAt).toBe("2026-02-28T00:00:00.000Z");
  });

  it("stacks a renewal onto unexpired time rather than discarding it", async () => {
    // Paying early must never burn the days already bought.
    const t1 = new Date("2026-01-15T00:00:00Z");
    await grantInterval(h.db, USER, { planId: "m3", months: 3, source: "payment" }, t1);

    const t2 = new Date("2026-02-15T00:00:00Z"); // 2 months still left
    const e = await grantInterval(h.db, USER, { planId: "m3", months: 3, source: "payment" }, t2);
    expect(e.expiresAt).toBe("2026-07-15T00:00:00.000Z"); // 15 Apr + 3 months
  });

  it("restarts from now when the previous plan already lapsed", async () => {
    const t1 = new Date("2026-01-15T00:00:00Z");
    await grantInterval(h.db, USER, { planId: "m1", months: 1, source: "payment" }, t1);

    const t2 = new Date("2026-06-01T00:00:00Z"); // long expired
    const e = await grantInterval(h.db, USER, { planId: "m1", months: 1, source: "payment" }, t2);
    expect(e.expiresAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("reports expired once the date passes", async () => {
    await grantInterval(
      h.db,
      USER,
      { planId: "trial", days: 7, source: "trial" },
      new Date("2026-07-01T00:00:00Z"),
    );
    expect((await readEntitlement(h.db, USER, new Date("2026-07-20T00:00:00Z"))).status).toBe(
      "expired",
    );
  });

  it("records an auditable ledger entry for every grant", async () => {
    const t1 = new Date("2026-01-15T00:00:00Z");
    await grantInterval(h.db, USER, { planId: "trial", days: 7, source: "trial" }, t1);
    await grantInterval(
      h.db,
      USER,
      { planId: "m3", months: 3, source: "payment", paymentId: null, note: "test" },
      t1,
    );

    const ledger = await listGrants(h.db, USER);
    expect(ledger).toHaveLength(2);
    const payment = ledger.find((g) => g.source === "payment")!;
    // The ledger answers "why does this account expire then?" without replaying
    // any business logic.
    expect(payment.months).toBe(3);
    expect(payment.expiresBefore).not.toBeNull();
    expect(payment.expiresAfter).not.toBeNull();
  });
});

describe("hasSettledGrant", () => {
  it("is false for a trial-only account, true once paid or imported", async () => {
    const now = new Date();
    await grantInterval(h.db, USER, { planId: "trial", days: 7, source: "trial" }, now);
    expect(await hasSettledGrant(h.db, USER)).toBe(false);

    await grantInterval(h.db, USER, { planId: "m1", months: 1, source: "payment" }, now);
    expect(await hasSettledGrant(h.db, USER)).toBe(true);
  });
});

describe("startTrialOnce", () => {
  const now = new Date("2026-08-21T00:00:00Z");

  it("starts exactly one seven-day trial", async () => {
    const result = await startTrialOnce(h.db, USER, now);
    expect(result.started).toBe(true);
    expect(result.entitlement).toMatchObject({
      status: "active",
      planId: "trial",
      expiresAt: "2026-08-28T00:00:00.000Z",
    });
    expect(await listGrants(h.db, USER)).toHaveLength(1);
  });

  it("returns the same entitlement on retry without extending it", async () => {
    const first = await startTrialOnce(h.db, USER, now);
    const second = await startTrialOnce(h.db, USER, new Date("2026-08-22T00:00:00Z"));
    expect(second).toMatchObject({ started: false, reason: "previous_grant" });
    expect(second.entitlement.expiresAt).toBe(first.entitlement.expiresAt);
    expect(await listGrants(h.db, USER)).toHaveLength(1);
  });

  it("serializes concurrent starts into one grant", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => startTrialOnce(h.db, USER, now)),
    );
    expect(results.filter((result) => result.started)).toHaveLength(1);
    expect(new Set(results.map((result) => result.entitlement.expiresAt))).toEqual(
      new Set(["2026-08-28T00:00:00.000Z"]),
    );
    expect(await listGrants(h.db, USER)).toHaveLength(1);
  });

  it("does not restart an expired previous trial", async () => {
    await grantInterval(
      h.db,
      USER,
      { planId: "trial", days: 7, source: "trial" },
      new Date("2026-07-01T00:00:00Z"),
    );
    const result = await startTrialOnce(h.db, USER, now);
    expect(result).toMatchObject({ started: false, reason: "previous_grant" });
    expect(result.entitlement.status).toBe("expired");
    expect(result.entitlement.expiresAt).toBe("2026-07-08T00:00:00.000Z");
  });

  for (const source of ["payment", "migration", "admin"] as const) {
    it(`refuses a trial after a previous ${source} grant`, async () => {
      await grantInterval(h.db, USER, { planId: "prior", days: 1, source }, now);
      const result = await startTrialOnce(h.db, USER, now);
      expect(result).toMatchObject({ started: false, reason: "previous_grant" });
      expect(
        (await listGrants(h.db, USER)).filter((grant) => grant.source === "trial"),
      ).toHaveLength(0);
    });
  }

  it("does not mint access when a materialized entitlement lacks ledger history", async () => {
    await h.raw(
      `insert into entitlements (user_id, plan_id, expires_at, updated_at)
       values ('${USER}', 'orphan', '2026-09-01T00:00:00Z', '2026-08-21T00:00:00Z')`,
    );
    const result = await startTrialOnce(h.db, USER, now);
    expect(result).toMatchObject({ started: false, reason: "entitlement_exists" });
    expect(result.entitlement.planId).toBe("orphan");
    expect(await listGrants(h.db, USER)).toHaveLength(0);
  });
});
