import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "../src/db/ddl.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ZARINPAL_MIGRATION_SQL = readFileSync(
  resolve(root, "supabase/migrations/20260828120000_zarinpal_only_payments.sql"),
  "utf8",
);

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

describe("launch schema repairs", () => {
  it("applies the production ZarinPal-only migration to the current schema", async () => {
    await h.raw(ZARINPAL_MIGRATION_SQL);

    const retired = await h.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'payments'
        and column_name in ('provider', 'provider_ref', 'track_id', 'psp_status')
    `);
    expect(retired).toHaveLength(0);
  });

  it("enforces ZarinPal-only payment and grant invariants", async () => {
    const columns = await h.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'payments'
        and column_name in ('attempt_id', 'authority', 'request_started_at', 'verify_started_at')
      order by column_name
    `);
    expect(columns.map((row) => row.column_name)).toEqual([
      "attempt_id",
      "authority",
      "request_started_at",
      "verify_started_at",
    ]);

    const indexes = await h.query<{ indexname: string; indexdef: string }>(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'payments_user_attempt_unique',
          'payments_authority',
          'grants_payment_id_unique'
        )
      order by indexname
    `);

    expect(indexes.map((row) => row.indexname)).toEqual([
      "grants_payment_id_unique",
      "payments_authority",
      "payments_user_attempt_unique",
    ]);
    expect(
      indexes.find((row) => row.indexname === "payments_user_attempt_unique")?.indexdef,
    ).toMatch(/unique.*\(user_id, attempt_id\)/i);
    expect(indexes.find((row) => row.indexname === "payments_authority")?.indexdef).toMatch(
      /unique.*\(authority\)/i,
    );
    expect(indexes.find((row) => row.indexname === "grants_payment_id_unique")?.indexdef).toMatch(
      /unique.*\(payment_id\).*where \(payment_id is not null\)/i,
    );
    const retired = await h.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_name = 'payments'
        and column_name in ('provider', 'provider_ref', 'track_id', 'psp_status')
    `);
    expect(retired).toHaveLength(0);
  });

  it("refuses to install grant uniqueness over duplicate financial history", async () => {
    await h.raw(`
      drop index grants_payment_id_unique;
      insert into users (id, phone)
      values ('11111111-1111-4111-8111-111111111111', '989122211111');
      insert into payments (
        id, user_id, plan_id, months, amount_toman, amount_rial, status
      ) values (
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        'm1', 1, 59000, 590000, 'paid'
      );
      insert into grants (user_id, source, payment_id) values
        (
          '11111111-1111-4111-8111-111111111111',
          'payment',
          '22222222-2222-4222-8222-222222222222'
        ),
        (
          '11111111-1111-4111-8111-111111111111',
          'payment',
          '22222222-2222-4222-8222-222222222222'
        );
    `);

    await expect(h.raw(SCHEMA_SQL)).rejects.toThrow(/duplicate grants\.payment_id/i);
    expect(
      await h.query(`
        select id from grants
        where payment_id = '22222222-2222-4222-8222-222222222222'
      `),
    ).toHaveLength(2);
  });

  it("refuses to drop legacy gateway columns while an unsettled payment exists", async () => {
    await h.raw(`
      alter table payments add column provider text;
      alter table payments add column track_id bigint;
      insert into users (id, phone)
      values ('31111111-1111-4111-8111-111111111111', '989122211112');
      insert into payments (
        user_id, plan_id, months, amount_toman, amount_rial, status, provider, track_id
      ) values (
        '31111111-1111-4111-8111-111111111111', 'm1', 1, 59000, 590000,
        'redirected', 'legacy', 12345
      );
    `);

    await expect(h.raw(ZARINPAL_MIGRATION_SQL)).rejects.toThrow(
      /unsettled legacy-provider payments/i,
    );
    // The migration owns an explicit transaction. A real migration runner
    // rolls it back after the exception; PGlite's raw session needs the same
    // cleanup before this test can inspect the unchanged legacy schema.
    await h.raw("rollback");
    const columns = await h.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_name = 'payments' and column_name in ('provider', 'track_id')
    `);
    expect(columns).toHaveLength(2);
  });

  it("clears only the retired device-switch lock while retaining a blocked account", async () => {
    await h.raw(`
      insert into users (phone, blocked, security_locked_at, security_lock_reason) values
        ('989122200001', true, now(), 'device_switch_limit'),
        ('989122200002', false, now(), 'manual_investigation');
    `);

    await h.raw(SCHEMA_SQL);

    const rows = await h.query<{
      phone: string;
      blocked: boolean;
      security_locked_at: string | null;
      security_lock_reason: string | null;
    }>(
      `select phone, blocked, security_locked_at, security_lock_reason from users where phone like '9891222%' order by phone`,
    );
    expect(rows).toEqual([
      {
        phone: "989122200001",
        blocked: true,
        security_locked_at: null,
        security_lock_reason: null,
      },
      {
        phone: "989122200002",
        blocked: false,
        security_locked_at: expect.any(Date),
        security_lock_reason: "manual_investigation",
      },
    ]);
  });

  it("generates zero-policy RLS lockdown for every server-owned table", () => {
    execFileSync(process.execPath, ["scripts/gen-setup-sql.mjs"], { cwd: root, stdio: "pipe" });
    const sql = readFileSync(resolve(root, "supabase/setup.sql"), "utf8");

    for (const table of [
      "users",
      "records",
      "devices",
      "device_security_events",
      "otp_codes",
      "login_attempts",
      "plans",
      "discounts",
      "redemptions",
      "payments",
      "grants",
      "entitlements",
      "feedback",
      "admins",
    ]) {
      expect(sql).toContain(`alter table ${table} enable row level security;`);
    }
    expect(sql).not.toContain("create policy");
  });

  it("generates valid dollar-quoted SQL for the device purge cron job", () => {
    execFileSync(process.execPath, ["scripts/gen-setup-sql.mjs"], { cwd: root, stdio: "pipe" });
    const sql = readFileSync(resolve(root, "supabase/setup.sql"), "utf8");

    expect(sql).toContain(
      "$$delete from devices where revoked_at is not null and revoked_at < now() - interval '30 days'$$",
    );
    expect(sql).not.toContain("\n  $delete from devices");
  });
});
