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
const HABIT_MONTH_MIGRATION_SQL = readFileSync(
  resolve(root, "supabase/migrations/20260831120000_compact_habit_logs_by_month.sql"),
  "utf8",
);
const ACCOUNT_SYNC_BUDGET_MIGRATION_SQL = readFileSync(
  resolve(root, "supabase/migrations/20260831130000_account_sync_budgets.sql"),
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
  it("backfills exact account usage before enabling sync storage budgets", async () => {
    await h.raw(`
      drop trigger records_sync_usage_after_insert on records;
      drop trigger records_sync_usage_after_update on records;
      drop trigger records_sync_usage_after_delete on records;
      alter table users drop constraint users_sync_record_count_bounds;
      alter table users drop constraint users_sync_data_bytes_bounds;
      alter table users drop column sync_record_count;
      alter table users drop column sync_data_bytes;

      insert into users (id, phone) values
        ('71111111-1111-4111-8111-111111111111', '989122211116');
      insert into records (user_id, kind, id, data, updated_at, deleted, seq) values
        (
          '71111111-1111-4111-8111-111111111111', 'habits', 'h1',
          '{"id":"h1","name":"walk"}', 1, false, 1
        ),
        (
          '71111111-1111-4111-8111-111111111111', 'journal', '2026-08-31',
          null, 2, true, 2
        );
    `);

    await h.raw(ACCOUNT_SYNC_BUDGET_MIGRATION_SQL);

    const [usage] = await h.query<{
      sync_record_count: number;
      sync_data_bytes: number;
      actual_bytes: number;
    }>(`
      select u.sync_record_count,
             u.sync_data_bytes,
             coalesce(sum(octet_length(r.data::text)), 0)::bigint as actual_bytes
        from users u left join records r on r.user_id = u.id
       where u.id = '71111111-1111-4111-8111-111111111111'
       group by u.id
    `);
    expect(Number(usage!.sync_record_count)).toBe(2);
    expect(Number(usage!.sync_data_bytes)).toBe(Number(usage!.actual_bytes));

    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values (
        '71111111-1111-4111-8111-111111111111', 'habits', 'h2',
        '{"id":"h2"}', 3, false, 3
      )
    `);
    const [after] = await h.query<{ sync_record_count: number }>(`
      select sync_record_count from users
       where id = '71111111-1111-4111-8111-111111111111'
    `);
    expect(Number(after!.sync_record_count)).toBe(3);
  });

  it("compacts legacy daily habit logs without losing cells or tombstones", async () => {
    await h.raw(`
      alter table records drop constraint records_kind_valid;
      alter table records add constraint records_kind_valid check (kind in
        ('categories','habits','logs','habitMonths','tasks','timerSessions','journal'));
      insert into users (id, phone, seq) values
        ('51111111-1111-4111-8111-111111111111', '989122211114', 4);
      insert into records (user_id, kind, id, data, updated_at, deleted, seq) values
        (
          '51111111-1111-4111-8111-111111111111', 'logs', 'h1|2026-08-01',
          '{"habitId":"h1","dateKey":"2026-08-01","value":1,"done":true}',
          1000, false, 1
        ),
        (
          '51111111-1111-4111-8111-111111111111', 'logs', 'h1|2026-08-02',
          null, 2000, true, 2
        ),
        (
          '51111111-1111-4111-8111-111111111111', 'logs', 'h1|2026-09-01',
          '{"habitId":"h1","dateKey":"2026-09-01","value":0,"done":false}',
          3000, false, 3
        ),
        (
          '51111111-1111-4111-8111-111111111111', 'habits', 'h1',
          '{"id":"h1"}', 4000, false, 4
        );
    `);

    await h.raw(HABIT_MONTH_MIGRATION_SQL);

    const rows = await h.query<{
      id: string;
      data: {
        cells: Record<
          string,
          { value?: number; done?: boolean; updatedAt: number; deleted: boolean }
        >;
      };
    }>(`
      select id, data from records
       where user_id = '51111111-1111-4111-8111-111111111111'
         and kind = 'habitMonths'
       order by id
    `);
    expect(rows.map((row) => row.id)).toEqual(["h1|2026-08", "h1|2026-09"]);
    expect(rows[0]!.data.cells["01"]).toMatchObject({
      value: 1,
      done: true,
      updatedAt: 1000,
      deleted: false,
    });
    expect(rows[0]!.data.cells["02"]).toEqual({
      updatedAt: 2000,
      deleted: true,
    });
    expect(await h.query(`select 1 from records where kind = 'logs'`)).toHaveLength(0);

    const [user] = await h.query<{ seq: string; gc_seq: string }>(`
      select seq::text, gc_seq::text from users
       where id = '51111111-1111-4111-8111-111111111111'
    `);
    expect(Number(user!.seq)).toBe(6);
    expect(Number(user!.gc_seq)).toBe(4);
    await expect(
      h.raw(`
        insert into records (user_id, kind, id, data, updated_at, deleted, seq)
        values (
          '51111111-1111-4111-8111-111111111111', 'logs', 'h1|2026-10-01',
          '{}', 1, false, 7
        )
      `),
    ).rejects.toThrow(/records_kind_valid/i);
  });

  it("rolls back month compaction instead of guessing over malformed history", async () => {
    await h.raw(`
      alter table records drop constraint records_kind_valid;
      alter table records add constraint records_kind_valid check (kind in
        ('categories','habits','logs','habitMonths','tasks','timerSessions','journal'));
      insert into users (id, phone, seq) values
        ('61111111-1111-4111-8111-111111111111', '989122211115', 1);
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values (
        '61111111-1111-4111-8111-111111111111', 'logs', 'h1|2026-08-01',
        '{"habitId":"other","dateKey":"2026-08-01","value":1,"done":true}',
        1000, false, 1
      );
    `);

    await expect(h.raw(HABIT_MONTH_MIGRATION_SQL)).rejects.toThrow(/malformed legacy habit logs/i);
    await h.raw("rollback");

    expect(await h.query(`select 1 from records where kind = 'logs'`)).toHaveLength(1);
    expect(await h.query(`select 1 from records where kind = 'habitMonths'`)).toHaveLength(0);
  });

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
      alter table payments add column if not exists provider text;
      alter table payments add column if not exists track_id bigint;
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

  it("allows cleanup when every unapplied legacy payment is terminal", async () => {
    await h.raw(`
      alter table payments add column if not exists provider text;
      alter table payments add column if not exists track_id bigint;
      insert into users (id, phone)
      values ('41111111-1111-4111-8111-111111111111', '989122211113');
      insert into payments (
        user_id, plan_id, months, amount_toman, amount_rial, status, provider, track_id
      ) values
        (
          '41111111-1111-4111-8111-111111111111', 'm1', 1, 59000, 590000,
          'failed', 'legacy', null
        ),
        (
          '41111111-1111-4111-8111-111111111111', 'm1', 1, 59000, 590000,
          'canceled', 'legacy', 12346
        );
    `);

    await h.raw(ZARINPAL_MIGRATION_SQL);
    const columns = await h.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_name = 'payments' and column_name in ('provider', 'track_id')
    `);
    expect(columns).toHaveLength(0);
  });

  it("removes the retired device and blocking schema from an existing database", async () => {
    await h.raw(`
      alter table users add column blocked boolean not null default false;
      alter table users add column max_active_devices integer not null default 1;
      alter table users add column security_locked_at timestamptz;
      alter table users add column security_lock_reason text;
      alter table users add column device_switch_reset_at timestamptz;
      create table devices (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        refresh_hash text not null
      );
      create table device_security_events (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        device_id uuid references devices(id) on delete set null
      );
      insert into users (phone, blocked, security_locked_at, security_lock_reason) values
        ('989122200001', true, now(), 'device_switch_limit'),
        ('989122200002', false, now(), 'manual_investigation');
      insert into devices (user_id, refresh_hash)
      select id, 'old-refresh' from users where phone = '989122200001';
    `);

    await h.raw(SCHEMA_SQL);

    const columns = await h.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_name = 'users' and column_name in (
        'blocked', 'max_active_devices', 'security_locked_at',
        'security_lock_reason', 'device_switch_reset_at'
      )
    `);
    expect(columns).toHaveLength(0);

    const tables = await h.query<{ table_name: string }>(`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('devices', 'device_security_events')
    `);
    expect(tables).toHaveLength(0);
  });

  it("generates zero-policy RLS lockdown for every server-owned table", () => {
    execFileSync(process.execPath, ["scripts/gen-setup-sql.mjs"], { cwd: root, stdio: "pipe" });
    const sql = readFileSync(resolve(root, "supabase/setup.sql"), "utf8");

    for (const table of [
      "users",
      "records",
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

  it("does not generate the retired device purge job", () => {
    execFileSync(process.execPath, ["scripts/gen-setup-sql.mjs"], { cwd: root, stdio: "pipe" });
    const sql = readFileSync(resolve(root, "supabase/setup.sql"), "utf8");

    expect(sql).not.toContain("routino-devices-purge");
    expect(sql).not.toContain("delete from devices");
  });
});
