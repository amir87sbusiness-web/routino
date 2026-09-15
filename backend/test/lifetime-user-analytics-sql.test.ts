import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

const migrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260911120000_lifetime_user_analytics.sql",
    import.meta.url,
  ),
);

describe("lifetime user analytics migration", () => {
  let h: Harness | undefined;

  afterAll(async () => {
    await h?.close();
  });

  it("backfills live users, survives account deletion, and counts returns without same-day double counting", async () => {
    h = await makeHarness();

    await h.raw(`
      insert into users (
        id, phone, created_at, active_days, last_active_at
      ) values
        (
          '20000000-0000-4000-8000-000000000001',
          '989120002001',
          '2026-09-01T08:00:00+03:30',
          2,
          '2026-09-10T08:00:00+03:30'
        ),
        (
          '20000000-0000-4000-8000-000000000002',
          '989120002002',
          '2026-09-02T08:00:00+03:30',
          1,
          '2026-09-10T09:00:00+03:30'
        );

      insert into grants (
        user_id, days, source, expires_before, expires_after
      ) values (
        '20000000-0000-4000-8000-000000000001',
        7,
        'trial',
        null,
        '2026-09-08T08:00:00+03:30'
      );
    `);

    const migration = readFileSync(migrationPath, "utf8");
    await h.script(migration);

    expect(
      await h.query<{
        phone: string;
        registration_count: number;
        active_days_lifetime: number;
        trial_started: boolean;
        current_user_id: string | null;
      }>(`
        select phone, registration_count, active_days_lifetime,
               trial_started, current_user_id
          from lifetime_users
         order by phone
      `),
    ).toEqual([
      {
        phone: "989120002001",
        registration_count: 1,
        active_days_lifetime: 2,
        trial_started: true,
        current_user_id: "20000000-0000-4000-8000-000000000001",
      },
      {
        phone: "989120002002",
        registration_count: 1,
        active_days_lifetime: 1,
        trial_started: false,
        current_user_id: "20000000-0000-4000-8000-000000000002",
      },
    ]);

    const [initialMetrics] = await h.query<{
      lifetime_users: number;
      current_accounts: number;
      returning_users: number;
      re_registered_users: number;
      total_re_registrations: number;
      trial_users: number;
    }>(`
      select lifetime_users::int,
             current_accounts::int,
             returning_users::int,
             re_registered_users::int,
             total_re_registrations::int,
             trial_users::int
        from routino_lifetime_user_metrics('2026-09-11T12:00:00+03:30')
    `);
    expect(initialMetrics).toMatchObject({
      lifetime_users: 2,
      current_accounts: 2,
      returning_users: 1,
      re_registered_users: 0,
      total_re_registrations: 0,
      trial_users: 1,
    });

    // Simulate the existing automatic retention cleanup. The operational row
    // disappears, while the lifetime identity survives and is detached by FK.
    await h.raw(`
      delete from users
       where id = '20000000-0000-4000-8000-000000000002';
    `);
    expect(
      await h.query<{ current_user_id: string | null }>(`
        select current_user_id
          from lifetime_users
         where phone = '989120002002'
      `),
    ).toEqual([{ current_user_id: null }]);

    // Re-register the same phone. It is one lifetime user, two registrations.
    await h.raw(`
      insert into users (id, phone, created_at)
      values (
        '20000000-0000-4000-8000-000000000003',
        '989120002002',
        '2026-09-10T12:00:00+03:30'
      );
    `);
    const [reRegistered] = await h.query<{
      registration_count: number;
      current_user_id: string;
      first_joined_unchanged: boolean;
    }>(`
      select registration_count,
             current_user_id::text,
             first_joined_at = '2026-09-02T08:00:00+03:30'::timestamptz
               as first_joined_unchanged
        from lifetime_users
       where phone = '989120002002'
    `);
    expect(reRegistered).toMatchObject({
      registration_count: 2,
      first_joined_unchanged: true,
      current_user_id: "20000000-0000-4000-8000-000000000003",
    });

    // Same Tehran day as the previous account's last activity: do not count a
    // second lifetime active day merely because the account row was recreated.
    await h.raw(`
      update users
         set active_days = 1,
             last_active_at = '2026-09-10T15:00:00+03:30'
       where id = '20000000-0000-4000-8000-000000000003';
    `);
    expect(
      await h.query<{ active_days_lifetime: number }>(`
        select active_days_lifetime
          from lifetime_users
         where phone = '989120002002'
      `),
    ).toEqual([{ active_days_lifetime: 1 }]);

    // A genuinely later Tehran day is one real return day.
    await h.raw(`
      update users
         set active_days = 2,
             last_active_at = '2026-09-11T08:00:00+03:30'
       where id = '20000000-0000-4000-8000-000000000003';
    `);

    const [finalMetrics] = await h.query<{
      lifetime_users: number;
      current_accounts: number;
      returning_users: number;
      re_registered_users: number;
      total_re_registrations: number;
    }>(`
      select lifetime_users::int,
             current_accounts::int,
             returning_users::int,
             re_registered_users::int,
             total_re_registrations::int
        from routino_lifetime_user_metrics('2026-09-11T12:00:00+03:30')
    `);
    expect(finalMetrics).toMatchObject({
      lifetime_users: 2,
      current_accounts: 2,
      returning_users: 2,
      re_registered_users: 1,
      total_re_registrations: 1,
    });

    // Applying the migration again is safe: backfill must not create fake
    // re-registrations or inflate activity counters.
    await h.script(migration);
    const [rerun] = await h.query<{
      lifetime_users: number;
      returning_users: number;
      re_registered_users: number;
      total_re_registrations: number;
    }>(`
      select lifetime_users::int,
             returning_users::int,
             re_registered_users::int,
             total_re_registrations::int
        from routino_lifetime_user_metrics('2026-09-11T12:00:00+03:30')
    `);
    expect(rerun).toMatchObject({
      lifetime_users: 2,
      returning_users: 2,
      re_registered_users: 1,
      total_re_registrations: 1,
    });
  });
});
