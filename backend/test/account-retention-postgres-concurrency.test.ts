import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "../src/db/ddl.js";
import { schema } from "../src/db/schema.js";
import type { PspProvider } from "../src/providers/psp/index.js";
import { checkoutPayment } from "../src/services/payment-flow.js";

const connectionString = process.env.ROUTINO_TEST_POSTGRES_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres("account cleanup on real PostgreSQL", () => {
  let admin: Client;
  let pool: Pool;

  beforeAll(async () => {
    admin = new Client({ connectionString });
    pool = new Pool({ connectionString, max: 4 });
    await admin.connect();
    await admin.query(SCHEMA_SQL);
  }, 20_000);

  beforeEach(async () => {
    await admin.query(`
      truncate table
        feedback, entitlements, grants, payments, redemptions, discounts,
        plans, auth_rate_limit_buckets, otp_codes, records, users,
        anonymous_counters
      restart identity cascade
    `);
    await admin.query(`
      insert into plans (id, name_fa, name_en, months, price_toman)
      values ('m1', 'یک‌ماهه', '1 Month', 1, 59000)
    `);
    await admin.query(`
      update account_retention_policy
         set deployed_at = '-infinity', preexisting_grace_until = '-infinity'
       where key = 'trial_cleanup_v1'
    `);
  });

  afterAll(async () => {
    await admin?.end();
    await pool?.end();
  });

  it("skips an eligible account while its purchase transaction is in flight", async () => {
    const userId = "90000000-0000-4000-8000-000000000001";
    await admin.query(`insert into users (id, phone, created_at) values ($1, $2, $3)`, [
      userId,
      "989120009001",
      "2026-06-01T00:00:00Z",
    ]);

    const purchase = new Client({ connectionString });
    const cleanup = new Client({ connectionString });
    await Promise.all([purchase.connect(), cleanup.connect()]);
    try {
      await purchase.query("begin");
      await purchase.query(
        `insert into payments (
          user_id, plan_id, months, amount_toman, amount_rial, status, attempt_id
        ) values ($1, 'm1', 1, 59000, 590000, 'requesting', $2)`,
        [userId, crypto.randomUUID()],
      );

      const result = await cleanup.query<{ deleted_count: number }>(
        `select deleted_count from routino_cleanup_trial_accounts(100, $1)`,
        ["2026-09-02T12:00:00Z"],
      );
      expect(Number(result.rows[0]?.deleted_count)).toBe(0);

      await purchase.query("commit");
      expect(
        Number(
          (await admin.query(`select count(*) from users where id = $1`, [userId])).rows[0].count,
        ),
      ).toBe(1);
      expect(
        Number(
          (await admin.query(`select count(*) from payments where user_id = $1`, [userId])).rows[0]
            .count,
        ),
      ).toBe(1);
    } finally {
      await purchase.query("rollback").catch(() => undefined);
      await Promise.all([purchase.end(), cleanup.end()]);
    }
  }, 10_000);

  it("keeps the account when the real checkout is waiting for the PSP", async () => {
    const user = {
      id: "90000000-0000-4000-8000-000000000002",
      phone: "989120009002",
    };
    await admin.query(`insert into users (id, phone, created_at) values ($1, $2, $3)`, [
      user.id,
      user.phone,
      "2026-06-01T00:00:00Z",
    ]);

    let markPspStarted!: () => void;
    let releasePsp!: () => void;
    const pspStarted = new Promise<void>((resolve) => (markPspStarted = resolve));
    const pspReleased = new Promise<void>((resolve) => (releasePsp = resolve));
    const psp: PspProvider = {
      name: "fake",
      async request() {
        markPspStarted();
        await pspReleased;
        return { kind: "issued", authority: "TEST-AUTHORITY", code: 100 };
      },
      async verify() {
        return { kind: "pending", code: -1 };
      },
      startUrl(authority) {
        return `https://gateway.test/${authority}`;
      },
    };
    const db = drizzle(pool, { schema });
    const checkout = checkoutPayment(
      db,
      { PUBLIC_API_URL: "https://api.test", PSP_PROVIDER_MAX_CONCURRENCY: 64 },
      psp,
      user,
      { planId: "m1", attemptId: crypto.randomUUID(), platform: "web" },
      new Date("2026-09-02T12:00:00Z"),
    );

    await pspStarted;
    const cleanup = await admin.query<{ deleted_count: number }>(
      `select deleted_count from routino_cleanup_trial_accounts(100, $1)`,
      ["2026-09-02T12:00:00Z"],
    );
    expect(Number(cleanup.rows[0]?.deleted_count)).toBe(0);

    releasePsp();
    await expect(checkout).resolves.toMatchObject({ free: false, authority: "TEST-AUTHORITY" });
    expect(
      Number(
        (await admin.query(`select count(*) from users where id = $1`, [user.id])).rows[0].count,
      ),
    ).toBe(1);
  }, 10_000);

  it("finishes a small batch under its timeout with five thousand protected old accounts", async () => {
    await admin.query(`
      insert into users (phone, created_at)
      select '98915' || lpad(n::text, 8, '0'), '2026-01-01T00:00:00Z'
        from generate_series(1, 5000) as n;
      insert into grants (user_id, months, source, created_at)
      select id, 1, 'admin', '2026-01-02T00:00:00Z'
        from users where phone like '98915%';
      insert into users (phone, created_at) values
        ('989169999991', '2026-01-01T00:00:00Z'),
        ('989169999992', '2026-01-01T00:00:00Z');
    `);

    const started = performance.now();
    const result = await admin.query<{ deleted_count: number }>(
      `select deleted_count from routino_cleanup_trial_accounts(2, $1)`,
      ["2026-09-02T12:00:00Z"],
    );
    const elapsedMs = performance.now() - started;

    expect(Number(result.rows[0]?.deleted_count)).toBe(2);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(
      Number(
        (await admin.query(`select count(*) from users where phone like '98915%'`)).rows[0].count,
      ),
    ).toBe(5000);
  }, 15_000);
});
