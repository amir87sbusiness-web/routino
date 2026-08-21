import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "../src/db/ddl.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

describe("launch schema repairs", () => {
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
