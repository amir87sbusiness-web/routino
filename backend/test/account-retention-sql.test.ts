import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

const dryRunPath = fileURLToPath(
  new URL("../../supabase/precheck/20260902_trial_account_cleanup_dry_run.sql", import.meta.url),
);

describe("production account-cleanup dry-run", () => {
  it("returns anonymous safety counts and cannot mutate its controlled database", async () => {
    let dryRun = "";
    try {
      dryRun = readFileSync(dryRunPath, "utf8");
    } catch {
      // RED phase: the behavioral artifact has not been written yet.
    }
    expect(dryRun).not.toBe("");
    if (!dryRun) return;

    await h.raw(`
      insert into users (id, phone, created_at) values
        ('10000000-0000-4000-8000-000000000001', '989120001001', now() - interval '31 days'),
        ('10000000-0000-4000-8000-000000000002', '989120001002', now() - interval '40 days'),
        ('10000000-0000-4000-8000-000000000003', '989120001003', now() - interval '40 days'),
        ('10000000-0000-4000-8000-000000000004', '989120001004', now() - interval '40 days'),
        ('10000000-0000-4000-8000-000000000005', '989120001005', now() - interval '40 days'),
        ('10000000-0000-4000-8000-000000000006', '989120001006', now() - interval '40 days'),
        ('10000000-0000-4000-8000-000000000007', '989120001007', now() - interval '40 days'),
        ('10000000-0000-4000-8000-000000000008', '989120001008', now() - interval '40 days'),
        ('10000000-0000-4000-8000-000000000009', '989120001009', now() - interval '40 days'),
        ('10000000-0000-4000-8000-000000000010', '989120001010', now() - interval '40 days'),
        ('10000000-0000-4000-8000-000000000011', '989120001011', now() - interval '40 days');

      insert into entitlements (user_id, plan_id, expires_at) values
        ('10000000-0000-4000-8000-000000000002', 'trial', now() - interval '1 day'),
        ('10000000-0000-4000-8000-000000000003', 'trial', now() + interval '1 day'),
        ('10000000-0000-4000-8000-000000000005', 'm1', now() + interval '1 month'),
        ('10000000-0000-4000-8000-000000000006', 'trial', now() - interval '1 day');

      insert into grants (user_id, days, source, expires_before, expires_after) values
        ('10000000-0000-4000-8000-000000000002', 7, 'trial', null, now() - interval '1 day'),
        ('10000000-0000-4000-8000-000000000003', 7, 'trial', null, now() + interval '1 day'),
        ('10000000-0000-4000-8000-000000000005', 0, 'admin', null, now() + interval '1 month'),
        ('10000000-0000-4000-8000-000000000006', 7, 'trial', null, now() - interval '2 days');

      insert into payments (
        user_id, plan_id, months, amount_toman, amount_rial, status, attempt_id
      ) values
      (
        '10000000-0000-4000-8000-000000000004', 'm1', 1, 59000, 590000,
        'failed', gen_random_uuid()
      ),
      (
        '10000000-0000-4000-8000-000000000007', 'm1', 1, 59000, 590000,
        'paid', gen_random_uuid()
      ),
      (
        '10000000-0000-4000-8000-000000000008', 'm1', 1, 59000, 590000,
        'provider_unknown', gen_random_uuid()
      );

      insert into discounts (code, percent, phone, active, used_count) values
        ('USED-PHONE', 20, '989120001009', true, 1),
        ('REFERRED-PHONE', 20, '989120001011', true, 0),
        ('USED-GLOBAL', 20, null, true, 1);
      update payments
         set discount_code = 'REFERRED-PHONE'
       where user_id = '10000000-0000-4000-8000-000000000004';
      insert into redemptions (code, user_id, created_at) values
        ('USED-GLOBAL', '10000000-0000-4000-8000-000000000010', now());
    `);

    const before = await h.query<{ users: number; payments: number; grants: number }>(`
      select
        (select count(*)::int from users) as users,
        (select count(*)::int from payments) as payments,
        (select count(*)::int from grants) as grants
    `);
    const results = await h.script(dryRun);
    const rows = results.flatMap((result) => result.rows ?? []);
    const report = rows.find(
      (row): row is Record<string, unknown> =>
        typeof row === "object" && row !== null && "eligible_due_total" in row,
    );

    expect(report).toMatchObject({
      eligible_total: 3,
      eligible_no_trial_total: 1,
      eligible_trial_only_total: 2,
      normal_deadline_due_total: 2,
      eligible_due_total: 0,
      due_no_trial: 1,
      due_trial_only: 1,
      active_trial_deferred: 1,
      preexisting_grace_deferred: 2,
      protected_any_payment: 3,
      protected_paid_payment: 1,
      protected_ambiguous_payment: 1,
      protected_other_financial_history: 1,
      protected_non_trial_grant: 1,
      protected_used_redemption: 1,
      protected_used_discount: 1,
      protected_referenced_private_discount: 1,
      protected_inconsistent_state: 1,
      selected_with_payment: 0,
      selected_with_non_trial_grant: 0,
      selected_with_used_redemption: 0,
      selected_with_used_discount: 0,
      selected_with_referenced_private_discount: 0,
    });
    expect(await h.query(`select id from users`)).toHaveLength(11);
    expect(
      await h.query<{ users: number; payments: number; grants: number }>(`
        select
          (select count(*)::int from users) as users,
          (select count(*)::int from payments) as payments,
          (select count(*)::int from grants) as grants
      `),
    ).toEqual(before);
    expect(Object.keys(report ?? {}).some((key) => /phone|user_?id/i.test(key))).toBe(false);
  });
});
