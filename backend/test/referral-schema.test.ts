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

async function insertUser(phone: string, code?: string) {
  const referral = code == null ? "null" : `'${code}'`;
  const [user] = await h.query<{ id: string }>(
    `insert into users (phone, referral_code) values ('${phone}', ${referral}) returning id`,
  );
  return user!.id;
}

async function insertPayment(userId: string, authority: string) {
  const [payment] = await h.query<{ id: string }>(`
    insert into payments
      (user_id, plan_id, months, amount_toman, amount_rial, status, authority,
       psp_result, applied_at)
    values
      ('${userId}', 'm1', 1, 59000, 590000, 'paid', '${authority}', 100, now())
    returning id
  `);
  return payment!.id;
}

describe("referral schema", () => {
  it("accepts only unique six-letter uppercase referral codes", async () => {
    await expect(insertUser("989120000001", "ABC123")).rejects.toThrow();
    await expect(insertUser("989120000002", "abcdef")).rejects.toThrow();
    await insertUser("989120000003", "ABCDEF");
    await expect(insertUser("989120000004", "ABCDEF")).rejects.toThrow();
    await expect(insertUser("989120000005")).resolves.toEqual(expect.any(String));
  });

  it("keeps the referral policy a single named rollout row", async () => {
    const rows = await h.query<{ key: string; started_at: Date }>(
      `select key, started_at from referral_program_policy`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe("referral_v1");
    await expect(
      h.raw(`insert into referral_program_policy (key, started_at) values ('other', now())`),
    ).rejects.toThrow();
  });

  it("enforces one invitee, paired success fields, and one success per payment", async () => {
    const inviterId = await insertUser("989120000011", "INVAAA");
    const inviteeId = await insertUser("989120000012", "INVAAB");
    const otherInviteeId = await insertUser("989120000013", "INVAAC");
    const paymentId = await insertPayment(inviteeId, "SCHEMA-REF-1");

    await h.raw(`
      insert into referrals (inviter_id, invitee_id, claimed_code, claimed_at)
      values ('${inviterId}', '${inviteeId}', 'INVAAA', now())
    `);
    await expect(
      h.raw(`
        insert into referrals (inviter_id, invitee_id, claimed_code, claimed_at)
        values ('${inviterId}', '${inviteeId}', 'INVAAA', now())
      `),
    ).rejects.toThrow();
    await expect(
      h.raw(`
        update referrals set successful_payment_id = '${paymentId}'
         where invitee_id = '${inviteeId}'
      `),
    ).rejects.toThrow();
    await h.raw(`
      update referrals
         set successful_payment_id = '${paymentId}', successful_at = now()
       where invitee_id = '${inviteeId}'
    `);
    await h.raw(`
      insert into referrals (inviter_id, invitee_id, claimed_code, claimed_at)
      values ('${inviterId}', '${otherInviteeId}', 'INVAAA', now())
    `);
    await expect(
      h.raw(`
        update referrals
           set successful_payment_id = '${paymentId}', successful_at = now()
         where invitee_id = '${otherInviteeId}'
      `),
    ).rejects.toThrow();
  });

  it("sets a deleted inviter to null and deletes a pending invitee claim", async () => {
    const inviterId = await insertUser("989120000021", "DELAAA");
    const inviteeId = await insertUser("989120000022", "DELAAB");
    await h.raw(`
      insert into referrals (inviter_id, invitee_id, claimed_code, claimed_at)
      values ('${inviterId}', '${inviteeId}', 'DELAAA', now())
    `);
    await h.raw(`delete from users where id = '${inviterId}'`);
    expect(await h.query(`select invitee_id from referrals where inviter_id is null`)).toHaveLength(
      1,
    );
    await h.raw(`delete from users where id = '${inviteeId}'`);
    expect(await h.query(`select invitee_id from referrals`)).toHaveLength(0);
  });

  it("preserves successful referral audit and counts when the invitee is deleted", async () => {
    const inviterId = await insertUser("989120000023", "SUCDEL");
    const inviteeId = await insertUser("989120000024", "SUCDEE");
    const paymentId = await insertPayment(inviteeId, "SCHEMA-REF-DELETE");
    await h.raw(`
      insert into referrals (
        inviter_id, invitee_id, claimed_code, claimed_at,
        successful_payment_id, successful_at
      ) values (
        '${inviterId}', '${inviteeId}', 'SUCDEL', now(), '${paymentId}', now()
      )
    `);

    await h.raw(`delete from users where id = '${inviteeId}'`);

    expect(
      await h.query<{
        inviter_id: string;
        invitee_id: string | null;
        successful_payment_id: string;
      }>(`
        select inviter_id, invitee_id, successful_payment_id from referrals
      `),
    ).toEqual([
      {
        inviter_id: inviterId,
        invitee_id: null,
        successful_payment_id: paymentId,
      },
    ]);
    expect(
      await h.query(`
        select id from referrals
         where inviter_id = '${inviterId}' and successful_at is not null
      `),
    ).toHaveLength(1);
  });

  it("does not expose the referral delete trigger function for public execution", async () => {
    const [fn] = await h.query<{ prosecdef: boolean; public_execute: boolean }>(`
      select p.prosecdef,
             exists (
               select 1
                 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
                where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
             ) as public_execute
        from pg_proc p
       where p.proname = 'routino_prepare_referrals_for_user_delete'
    `);
    expect(fn).toBeDefined();
    expect(fn!.prosecdef).toBe(false);
    expect(fn!.public_execute).toBe(false);
  });

  it("enforces unique non-null grant idempotency keys", async () => {
    const userId = await insertUser("989120000031", "GRNAAA");
    await h.raw(`
      insert into grants (user_id, source, idempotency_key)
      values ('${userId}', 'referral', 'referral:test:inviter')
    `);
    await expect(
      h.raw(`
        insert into grants (user_id, source, idempotency_key)
        values ('${userId}', 'referral', 'referral:test:inviter')
      `),
    ).rejects.toThrow();
    await h.raw(`insert into grants (user_id, source) values ('${userId}', 'trial')`);
  });

  it("provides indexes for every referral foreign key and successful invite counts", async () => {
    const indexes = await h.query<{ indexname: string }>(`
      select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'referrals'
    `);
    expect(indexes.map((row) => row.indexname).sort()).toEqual(
      expect.arrayContaining([
        "referrals_invitee_unique",
        "referrals_inviter",
        "referrals_successful_inviter",
        "referrals_successful_payment_unique",
      ]),
    );
  });
});
