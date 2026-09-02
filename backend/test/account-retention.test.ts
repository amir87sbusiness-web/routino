import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { startTrialOnce } from "../src/services/entitlement.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

const NOW = "2026-09-02T12:00:00.000Z";
const DAY = 86_400_000;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

async function addUser(
  phone: string,
  createdAt: string,
  extras = "",
): Promise<{ id: string; phone: string }> {
  const [row] = await h.query<{ id: string; phone: string }>(`
    insert into users (phone, created_at ${extras ? `, ${extras.split("=")[0]}` : ""})
    values ('${phone}', '${createdAt}'::timestamptz ${extras ? `, ${extras.split("=")[1]}` : ""})
    returning id::text, phone
  `);
  return row!;
}

async function addTrial(userId: string, expiresAt: string): Promise<void> {
  await h.raw(`
    insert into entitlements (user_id, plan_id, expires_at, updated_at)
    values ('${userId}', 'trial', '${expiresAt}'::timestamptz, '${NOW}'::timestamptz);
    insert into grants (
      user_id, months, days, source, expires_before, expires_after, created_at
    ) values (
      '${userId}', 0, 7, 'trial', null, '${expiresAt}'::timestamptz,
      ('${expiresAt}'::timestamptz - interval '7 days')
    );
  `);
}

async function deletionAt(userId: string): Promise<string | null> {
  const [row] = await h.query<{ deletion_at: string | null }>(`
    select routino_account_deletion_at('${userId}'::uuid)::text as deletion_at
  `);
  return row?.deletion_at ?? null;
}

async function cleanup(limit = 100, canaryUserId: string | null = null): Promise<number> {
  const [row] = await h.query<{ deleted_count: number }>(`
    select deleted_count
      from routino_cleanup_trial_accounts(
        ${limit}, '${NOW}'::timestamptz,
        ${canaryUserId ? `'${canaryUserId}'::uuid` : "null"}
      )
  `);
  return Number(row?.deleted_count ?? 0);
}

describe("trial-only account deletion deadline", () => {
  it("gives every account that predates deployment a one-time 30-day safety floor", async () => {
    await h.raw(`
      update account_retention_policy
         set deployed_at = '2026-09-02T00:00:00Z',
             preexisting_grace_until = '2026-10-02T00:00:00Z'
       where key = 'trial_cleanup_v1'
    `);
    const old = await addUser("989120000000", "2026-06-01T00:00:00Z");

    expect(await deletionAt(old.id)).toBe("2026-10-02 00:00:00+00");
    const [beforeFloor] = await h.query<{ deleted_count: number }>(`
      select deleted_count
        from routino_cleanup_trial_accounts(100, '2026-10-01T23:59:59Z')
    `);
    expect(Number(beforeFloor?.deleted_count)).toBe(0);
    const [atFloor] = await h.query<{ deleted_count: number }>(`
      select deleted_count
        from routino_cleanup_trial_accounts(100, '2026-10-02T00:00:00Z')
    `);
    expect(Number(atFloor?.deleted_count)).toBe(1);

    await h.raw(`
      update account_retention_policy
         set deployed_at = '-infinity', preexisting_grace_until = '-infinity'
       where key = 'trial_cleanup_v1'
    `);
  });

  it("does not delete an account younger than 30 complete days", async () => {
    const user = await addUser("989120000001", "2026-08-03T12:00:00.001Z");

    expect(await deletionAt(user.id)).toBe("2026-09-02 12:00:00.001+00");
    expect(await cleanup()).toBe(0);
    expect(await h.query(`select id from users where id = '${user.id}'`)).toHaveLength(1);
  });

  it("deletes a no-trial account at exactly created_at plus 30 days", async () => {
    const user = await addUser("989120000002", "2026-08-03T12:00:00.000Z");

    expect(await deletionAt(user.id)).toBe("2026-09-02 12:00:00+00");
    expect(await cleanup()).toBe(1);
    expect(await h.query(`select id from users where id = '${user.id}'`)).toHaveLength(0);
  });

  it("keeps a late-started active trial until its seven-day expiry", async () => {
    const user = await addUser("989120000003", "2026-07-24T12:00:00.000Z");
    await addTrial(user.id, "2026-09-03T12:00:00.000Z");

    expect(await deletionAt(user.id)).toBe("2026-09-03 12:00:00+00");
    expect(await cleanup()).toBe(0);
    expect(await h.query(`select id from users where id = '${user.id}'`)).toHaveLength(1);
  });

  it("deletes a consistent trial-only account after both deadlines", async () => {
    const user = await addUser("989120000004", "2026-07-01T12:00:00.000Z");
    await addTrial(user.id, "2026-07-20T12:00:00.000Z");

    expect(await cleanup()).toBe(1);
    expect(await h.query(`select id from users where id = '${user.id}'`)).toHaveLength(0);
  });
});

describe("fail-closed protection", () => {
  it.each(["payment", "admin", "migration", "future_source"])(
    "protects a user with a %s grant",
    async (source) => {
      const user = await addUser(
        `98912100${String(Math.random()).slice(2, 6)}`,
        "2026-06-01T00:00:00Z",
      );
      await h.raw(`
        insert into grants (user_id, months, days, source, created_at)
        values ('${user.id}', 1, 0, '${source}', '2026-06-01T00:00:00Z')
      `);

      expect(await deletionAt(user.id)).toBeNull();
      expect(await cleanup()).toBe(0);
    },
  );

  it.each(["paid", "redirected", "provider_unknown", "failed", "canceled"])(
    "protects every financial history row, including %s",
    async (status) => {
      const user = await addUser(
        `98912200${String(Math.random()).slice(2, 6)}`,
        "2026-06-01T00:00:00Z",
      );
      await h.raw(`
        insert into payments (
          user_id, plan_id, months, amount_toman, amount_rial, status, attempt_id,
          created_at, updated_at
        ) values (
          '${user.id}', 'm1', 1, 59000, 590000, '${status}', gen_random_uuid(),
          '2026-06-02T00:00:00Z', '2026-06-02T00:00:00Z'
        )
      `);

      expect(await deletionAt(user.id)).toBeNull();
      expect(await cleanup()).toBe(0);
      expect(await h.query(`select id from payments where user_id = '${user.id}'`)).toHaveLength(1);
    },
  );

  it("protects a used phone-restricted discount even if its ledger is inconsistent", async () => {
    const user = await addUser("989120000020", "2026-06-01T00:00:00Z");
    await h.raw(`
      insert into discounts (code, percent, phone, active, used_count)
      values ('USED20', 20, '${user.phone}', true, 1)
    `);

    expect(await deletionAt(user.id)).toBeNull();
    expect(await cleanup()).toBe(0);
    expect(await h.query(`select code from discounts where code = 'USED20'`)).toHaveLength(1);
  });

  it("protects an unused private discount and its owner when another payment references it", async () => {
    const owner = await addUser("989120000024", "2026-06-01T00:00:00Z");
    const payer = await addUser("989120000025", "2026-08-31T00:00:00Z");
    await h.raw(`
      insert into discounts (code, percent, phone, active, used_count)
      values ('REFERRED20', 20, '${owner.phone}', true, 0);
      insert into payments (
        user_id, plan_id, months, amount_toman, amount_rial, discount_code,
        status, attempt_id, created_at, updated_at
      ) values (
        '${payer.id}', 'm1', 1, 59000, 590000, 'REFERRED20',
        'provider_unknown', gen_random_uuid(), now(), now()
      );
    `);

    expect(await deletionAt(owner.id)).toBeNull();
    expect(await cleanup()).toBe(0);
    expect(await h.query(`select code from discounts where code = 'REFERRED20'`)).toHaveLength(1);
    expect(await h.query(`select id from users where id = '${owner.id}'`)).toHaveLength(1);
  });

  it("protects an account with a used discount redemption", async () => {
    const user = await addUser("989120000023", "2026-06-01T00:00:00Z");
    await h.raw(`
      insert into discounts (code, percent, active, used_count)
      values ('REDEEMED20', 20, true, 1);
      insert into redemptions (code, user_id, created_at)
      values ('REDEEMED20', '${user.id}', '2026-06-02T00:00:00Z');
    `);

    expect(await deletionAt(user.id)).toBeNull();
    expect(await cleanup()).toBe(0);
    expect(await h.query(`select code from redemptions where user_id = '${user.id}'`)).toHaveLength(
      1,
    );
  });

  it("protects mismatched or duplicate trial ledger state", async () => {
    const mismatch = await addUser("989120000021", "2026-06-01T00:00:00Z");
    await addTrial(mismatch.id, "2026-06-20T00:00:00Z");
    await h.raw(
      `update entitlements set expires_at = '2026-06-21T00:00:00Z' where user_id = '${mismatch.id}'`,
    );

    const duplicate = await addUser("989120000022", "2026-06-01T00:00:00Z");
    await addTrial(duplicate.id, "2026-06-20T00:00:00Z");
    await h.raw(`
      insert into grants (user_id, days, source, expires_after, created_at)
      values ('${duplicate.id}', 7, 'trial', '2026-06-20T00:00:00Z', '2026-06-13T00:00:00Z')
    `);

    expect(await deletionAt(mismatch.id)).toBeNull();
    expect(await deletionAt(duplicate.id)).toBeNull();
    expect(await cleanup()).toBe(0);
  });
});

describe("complete bounded deletion", () => {
  it("cascades taskMonths and ordinary records through existing quota accounting", async () => {
    const user = await addUser("989120000029", "2026-06-01T00:00:00Z");
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, seq) values
        ('${user.id}', 'tasks', 'task-live', '{"id":"task-live","title":"live"}', 1, 1),
        ('${user.id}', 'taskMonths', '2026-01', '{"version":1,"tasks":[]}', 2, 2),
        ('${user.id}', 'habitMonths', 'habit-2026-01', '{"cells":{}}', 3, 3);
    `);
    const [usage] = await h.query<{ sync_record_count: number; sync_data_bytes: number }>(`
      select sync_record_count, sync_data_bytes from users where id = '${user.id}'
    `);
    expect(Number(usage?.sync_record_count)).toBe(3);
    expect(Number(usage?.sync_data_bytes)).toBeGreaterThan(0);

    expect(await cleanup()).toBe(1);
    expect(await h.query(`select 1 from records where user_id = '${user.id}'`)).toEqual([]);
    expect(await h.query(`select 1 from users where id = '${user.id}'`)).toEqual([]);
  });

  it("stays bounded with five thousand old protected accounts before eligible rows", async () => {
    await h.raw(`
      insert into users (phone, created_at)
      select '98913' || lpad(n::text, 8, '0'), '2026-01-01T00:00:00Z'
        from generate_series(1, 5000) as n;
      insert into grants (user_id, months, source, created_at)
      select id, 1, 'admin', '2026-01-02T00:00:00Z'
        from users where phone like '98913%';
    `);
    await addUser("989149999991", "2026-01-01T00:00:00Z");
    await addUser("989149999992", "2026-01-01T00:00:00Z");

    expect(await cleanup(2)).toBe(2);
    const [protectedCount] = await h.query<{ count: number }>(`
      select count(*)::integer as count from users where phone like '98913%'
    `);
    expect(Number(protectedCount?.count)).toBe(5000);
  }, 10_000);

  it("removes all cloud-linked rows and an unused private discount", async () => {
    const user = await addUser("989120000030", "2026-06-01T00:00:00Z", "username='gone_user'");
    await h.raw(`
      update users set password_hash = 'scrypt$test' where id = '${user.id}';
      insert into records (user_id, kind, id, data, updated_at, seq)
      values ('${user.id}', 'journal', '2026-06-01', '{"text":"private"}', 1, 1);
      insert into otp_codes (phone, code_hash, expires_at, created_at)
      values ('${user.phone}', 'secret-hash', '2026-06-01T01:00:00Z', '2026-06-01T00:00:00Z');
      insert into feedback (user_id, rating, comment, at)
      values ('${user.id}', 5, 'private feedback', '2026-06-01T00:00:00Z');
      insert into discounts (code, percent, phone, active, used_count)
      values ('UNUSED30', 30, '${user.phone}', true, 0);
    `);

    expect(await cleanup()).toBe(1);
    expect(await h.query(`select id from users where id = '${user.id}'`)).toHaveLength(0);
    expect(await h.query(`select id from records where user_id = '${user.id}'`)).toHaveLength(0);
    expect(await h.query(`select id from otp_codes where phone = '${user.phone}'`)).toHaveLength(0);
    expect(await h.query(`select id from feedback where user_id = '${user.id}'`)).toHaveLength(0);
    expect(await h.query(`select code from discounts where phone = '${user.phone}'`)).toHaveLength(
      0,
    );
  });

  it("honours the batch limit and is idempotent", async () => {
    await addUser("989120000031", "2026-06-01T00:00:00Z");
    await addUser("989120000032", "2026-06-01T00:00:00Z");

    expect(await cleanup(1)).toBe(1);
    expect(await h.query(`select id from users`)).toHaveLength(1);
    expect(await cleanup(1)).toBe(1);
    expect(await cleanup(1)).toBe(0);
  });

  it("can restrict a separately approved canary run to one exact test account", async () => {
    const canary = await addUser("989120000033", "2026-06-01T00:00:00Z");
    const untouched = await addUser("989120000034", "2026-06-01T00:00:00Z");

    expect(await cleanup(1, canary.id)).toBe(1);
    expect(await h.query(`select id from users where id = '${canary.id}'`)).toHaveLength(0);
    expect(await h.query(`select id from users where id = '${untouched.id}'`)).toHaveLength(1);
  });
});

describe("anonymous trial start counter", () => {
  it("increments once per real start and not on retry", async () => {
    const user = await addUser("989120000040", NOW);
    const now = new Date(NOW);

    expect((await startTrialOnce(h.db, user.id, now)).started).toBe(true);
    expect((await startTrialOnce(h.db, user.id, now)).started).toBe(false);

    const [counter] = await h.query<{ value: number }>(`
      select value from anonymous_counters where key = 'trial_starts'
    `);
    expect(Number(counter?.value)).toBe(1);
    const columns = await h.query<{ column_name: string }>(`
      select column_name from information_schema.columns
       where table_name = 'anonymous_counters'
       order by ordinal_position
    `);
    expect(columns.map((row) => row.column_name)).toEqual(["key", "value"]);
  });

  it("counts a new account's new trial after the old account is deleted", async () => {
    const oldUser = await addUser("989120000041", "2026-06-01T00:00:00Z");
    await startTrialOnce(h.db, oldUser.id, new Date("2026-06-02T00:00:00Z"));
    expect(await cleanup()).toBe(1);

    const newUser = await addUser("989120000041", NOW);
    expect(newUser.id).not.toBe(oldUser.id);
    expect((await startTrialOnce(h.db, newUser.id, new Date(NOW))).started).toBe(true);

    const [counter] = await h.query<{ value: number }>(`
      select value from anonymous_counters where key = 'trial_starts'
    `);
    expect(Number(counter?.value)).toBe(2);
    expect(
      new Date(
        (
          await h.query<{ expires_at: string }>(`
      select expires_at::text from entitlements where user_id = '${newUser.id}'
    `)
        )[0]!.expires_at,
      ).getTime(),
    ).toBe(new Date(NOW).getTime() + 7 * DAY);
  });

  it("re-registers the same phone through OTP as a new UUID with a fresh seven-day trial", async () => {
    const phone = "09120000042";
    await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
    const firstLogin = await h.app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone, code: h.sms.last()!.code },
    });
    const old = firstLogin.json() as { access: string; user: { id: string } };
    await h.app.inject({
      method: "POST",
      url: "/v1/subscriptions/trial/start",
      headers: { authorization: `Bearer ${old.access}` },
    });
    await h.raw(`
      update users set created_at = '2026-06-01T00:00:00Z' where id = '${old.user.id}';
      update entitlements
         set expires_at = '2026-06-20T00:00:00Z'
       where user_id = '${old.user.id}';
      update grants
         set expires_before = null,
             expires_after = '2026-06-20T00:00:00Z',
             created_at = '2026-06-13T00:00:00Z'
       where user_id = '${old.user.id}' and source = 'trial';
    `);
    expect(await cleanup()).toBe(1);

    await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
    const secondLogin = await h.app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone, code: h.sms.last()!.code },
    });
    const fresh = secondLogin.json() as {
      access: string;
      isNew: boolean;
      user: { id: string };
      entitlement: { status: string };
    };
    expect(fresh.isNew).toBe(true);
    expect(fresh.user.id).not.toBe(old.user.id);
    expect(fresh.entitlement.status).toBe("none");

    const trial = await h.app.inject({
      method: "POST",
      url: "/v1/subscriptions/trial/start",
      headers: { authorization: `Bearer ${fresh.access}` },
    });
    const trialBody = trial.json() as {
      started: boolean;
      entitlement: { issuedAt: string; expiresAt: string };
    };
    expect(trialBody.started).toBe(true);
    expect(
      Date.parse(trialBody.entitlement.expiresAt) - Date.parse(trialBody.entitlement.issuedAt),
    ).toBe(7 * DAY);
  });
});
