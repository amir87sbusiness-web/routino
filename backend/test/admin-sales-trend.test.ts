import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminSalesTrend } from "../src/routes/admin-sales-trend.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

describe("admin sales trend", () => {
  it("keeps early repeat purchases out of the true renewal rate and bounds daily conversion", async () => {
    const earlyUser = "00000000-0000-4000-8000-000000000001";
    const renewalUser = "00000000-0000-4000-8000-000000000002";
    const expiredUser = "00000000-0000-4000-8000-000000000003";
    const convertedUser = "00000000-0000-4000-8000-000000000004";
    const signupOnlyUser = "00000000-0000-4000-8000-000000000005";

    await h.raw(`
      insert into users (id, phone, created_at) values
        ('${earlyUser}', '989120000001', '2026-08-20T08:00:00Z'),
        ('${renewalUser}', '989120000002', '2026-08-15T08:00:00Z'),
        ('${expiredUser}', '989120000003', '2026-09-01T08:00:00Z'),
        ('${convertedUser}', '989120000004', '2026-10-05T08:00:00Z'),
        ('${signupOnlyUser}', '989120000005', '2026-10-05T09:00:00Z');

      insert into payments
        (id, user_id, plan_id, months, amount_toman, amount_rial, status, applied_at, created_at, updated_at)
      values
        ('10000000-0000-4000-8000-000000000001', '${earlyUser}', 'm1', 1, 149000, 1490000, 'paid', '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z'),
        ('10000000-0000-4000-8000-000000000002', '${earlyUser}', 'm1', 1, 149000, 1490000, 'paid', '2026-09-20T09:00:00Z', '2026-09-20T09:00:00Z', '2026-09-20T09:00:00Z'),
        ('20000000-0000-4000-8000-000000000001', '${renewalUser}', 'm1', 1, 149000, 1490000, 'paid', '2026-08-15T09:00:00Z', '2026-08-15T09:00:00Z', '2026-08-15T09:00:00Z'),
        ('20000000-0000-4000-8000-000000000002', '${renewalUser}', 'm1', 1, 149000, 1490000, 'paid', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z'),
        ('30000000-0000-4000-8000-000000000001', '${expiredUser}', 'm1', 1, 149000, 1490000, 'paid', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z'),
        ('40000000-0000-4000-8000-000000000001', '${convertedUser}', 'm1', 1, 149000, 1490000, 'paid', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z');

      insert into grants
        (user_id, months, days, source, payment_id, expires_before, expires_after, created_at)
      values
        ('${earlyUser}', 1, 0, 'payment', '10000000-0000-4000-8000-000000000001', null, '2026-10-01T09:00:00Z', '2026-09-01T09:00:00Z'),
        ('${earlyUser}', 1, 0, 'payment', '10000000-0000-4000-8000-000000000002', '2026-10-01T09:00:00Z', '2026-11-01T09:00:00Z', '2026-09-20T09:00:00Z'),
        ('${renewalUser}', 1, 0, 'payment', '20000000-0000-4000-8000-000000000001', null, '2026-09-15T09:00:00Z', '2026-08-15T09:00:00Z'),
        ('${renewalUser}', 1, 0, 'payment', '20000000-0000-4000-8000-000000000002', '2026-09-15T09:00:00Z', '2026-10-20T10:00:00Z', '2026-09-20T10:00:00Z'),
        ('${expiredUser}', 1, 0, 'payment', '30000000-0000-4000-8000-000000000001', null, '2026-10-01T10:00:00Z', '2026-09-01T10:00:00Z'),
        ('${convertedUser}', 1, 0, 'payment', '40000000-0000-4000-8000-000000000001', null, '2026-11-05T10:00:00Z', '2026-10-05T10:00:00Z');
    `);

    const result = await adminSalesTrend(h.db, new Date("2026-10-07T12:00:00Z"), 90);
    const byDate = new Map(result.points.map((point) => [point.date, point]));

    expect(byDate.get("2026-09-20")).toMatchObject({
      renewals: 1,
      earlyRepeats: 1,
    });

    expect(byDate.get("2026-09-15")).toMatchObject({
      eligibleExpirations: 1,
      renewedExpirations: 1,
      renewalRate: 100,
    });

    expect(byDate.get("2026-10-01")).toMatchObject({
      eligibleExpirations: 1,
      renewedExpirations: 0,
      renewalRate: 0,
    });

    expect(byDate.get("2026-10-05")).toMatchObject({
      newUsers: 2,
      sameDayBuyers: 1,
      conversionRate: 50,
    });

    expect(result.totals).toMatchObject({
      renewals: 1,
      earlyRepeats: 1,
      eligibleExpirations: 2,
      renewedExpirations: 1,
      renewalRate: 50,
    });
    expect(result.lifetime).toMatchObject({
      totalUsers: 5,
      payingUsers: 4,
      conversionRate: 80,
      eligibleExpirations: 2,
      renewedExpirations: 1,
      renewalRate: 50,
      trueRenewals: 1,
      earlyRepeats: 1,
    });
    expect(result.totals.conversionRate).toBeLessThanOrEqual(100);
    expect(result.totals.renewalRate).toBeLessThanOrEqual(100);
    expect(result.lifetime.conversionRate).toBeLessThanOrEqual(100);
    expect(result.lifetime.renewalRate).toBeLessThanOrEqual(100);
  });
});
