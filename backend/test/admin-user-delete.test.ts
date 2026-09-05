import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminSignIn, makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  if (!h) {
    h = await makeHarness();
    // Mirror the production migration under test: payment history survives
    // user deletion and loses only its account FK.
    await h.raw(`
      alter table payments drop constraint if exists payments_user_id_fkey;
      alter table payments alter column user_id drop not null;
      alter table payments
        add constraint payments_user_id_users_id_fk
        foreign key (user_id) references users(id) on delete set null;
    `);
  }
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

const loginHash = (value: string) =>
  createHmac("sha256", h.env.OTP_PEPPER)
    .update(`login_identifier\0${value}`)
    .digest("hex");

async function createUser(username: string | null, phone: string) {
  const id = randomUUID();
  await h.raw(
    `insert into users (id, phone, username) values ('${id}', '${phone}', ${username ? `'${username}'` : "null"})`,
  );
  return { id, phone, username };
}

async function deleteAsAdmin(id: string, confirmation: string) {
  const headers = await adminSignIn(h);
  return h.app.inject({
    method: "POST",
    url: `/v1/admin/users/${id}/delete`,
    headers,
    payload: { confirmation },
  });
}

describe("admin permanent account deletion", () => {
  it("refuses a mismatched username without changing any data", async () => {
    const user = await createUser("victim", "989121111111");
    const paymentId = randomUUID();
    await h.raw(`
      insert into payments
        (id, user_id, plan_id, months, amount_toman, amount_rial, status, attempt_id, applied_at)
      values
        ('${paymentId}', '${user.id}', 'm1', 1, 59000, 590000, 'paid', '${randomUUID()}', now());
    `);

    const response = await deleteAsAdmin(user.id, "someone_else");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "delete_confirmation_mismatch" });
    expect(await h.query(`select id from users where id = '${user.id}'`)).toHaveLength(1);
    expect(await h.query(`select id from payments where id = '${paymentId}'`)).toHaveLength(1);
  });

  it("preserves financial payment rows while deleting account and app data", async () => {
    const user = await createUser("victim", "989121111111");
    const other = await createUser("other", "989122222222");
    const paymentId = randomUUID();
    const otherPaymentId = randomUUID();

    await h.raw(`
      update users set seq = 1 where id = '${user.id}';
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values ('${user.id}', 'habits', 'habit-1', '{"name":"private"}'::jsonb, 1, false, 1);

      insert into discounts (code, percent, phone, active, used_count)
      values ('PRIVATE10', 10, '${user.phone}', true, 2);

      insert into payments
        (id, user_id, plan_id, months, amount_toman, amount_rial, discount_code,
         discount_percent, status, attempt_id, applied_at)
      values
        ('${paymentId}', '${user.id}', 'm1', 1, 59000, 590000, 'PRIVATE10', 10, 'paid', '${randomUUID()}', now()),
        ('${otherPaymentId}', '${other.id}', 'm1', 1, 59000, 590000, 'PRIVATE10', 10, 'paid', '${randomUUID()}', now());

      insert into redemptions (code, user_id, payment_id)
      values
        ('PRIVATE10', '${user.id}', '${paymentId}'),
        ('PRIVATE10', '${other.id}', '${otherPaymentId}');

      insert into grants (user_id, months, source, payment_id)
      values ('${user.id}', 1, 'payment', '${paymentId}');

      insert into entitlements (user_id, plan_id, expires_at)
      values ('${user.id}', 'm1', now() + interval '1 month');

      insert into feedback (id, user_id, rating, section, comment, at)
      values ('${randomUUID()}', '${user.id}', 5, 'journal', 'private feedback', now());

      insert into otp_codes (id, phone, code_hash, expires_at)
      values ('${randomUUID()}', '${user.phone}', 'hash', now() + interval '2 minutes');

      insert into auth_rate_limit_buckets (scope, key_hash, window_start, count, expires_at)
      values
        ('login_identifier', '${loginHash(user.phone)}', date_trunc('minute', now()), 2, now() + interval '15 minutes'),
        ('login_identifier', '${loginHash(user.username!)}', date_trunc('minute', now()) + interval '1 second', 3, now() + interval '15 minutes');
    `);

    const response = await deleteAsAdmin(user.id, "victim");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, deletedUserId: user.id, username: "victim" });

    for (const [table, predicate] of [
      ["users", `id = '${user.id}'`],
      ["records", `user_id = '${user.id}'`],
      ["grants", `user_id = '${user.id}'`],
      ["entitlements", `user_id = '${user.id}'`],
      ["feedback", `user_id = '${user.id}'`],
      ["redemptions", `user_id = '${user.id}'`],
      ["otp_codes", `phone = '${user.phone}'`],
    ] as const) {
      expect(await h.query(`select 1 from ${table} where ${predicate}`), table).toHaveLength(0);
    }

    expect(
      await h.query<{ id: string; user_id: string | null }>(
        `select id, user_id from payments where id = '${paymentId}'`,
      ),
    ).toEqual([{ id: paymentId, user_id: null }]);

    const historyHeaders = await adminSignIn(h);
    const history = await h.app.inject({
      method: "GET",
      url: "/v1/admin/payments",
      headers: historyHeaders,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: paymentId,
          userId: null,
          phone: null,
          username: null,
          status: "paid",
        }),
      ]),
    );

    expect(
      await h.query(
        `select 1 from auth_rate_limit_buckets where scope = 'login_identifier' and key_hash in ('${loginHash(user.phone)}','${loginHash(user.username!)}')`,
      ),
    ).toHaveLength(0);

    expect(
      await h.query<{ phone: string | null; active: boolean }>(
        `select phone, active from discounts where code = 'PRIVATE10'`,
      ),
    ).toEqual([{ phone: null, active: false }]);

    expect(await h.query(`select id from users where id = '${other.id}'`)).toHaveLength(1);
    expect(await h.query(`select id from payments where id = '${otherPaymentId}'`)).toHaveLength(1);
  });

  it("blocks deletion while a payment can still settle", async () => {
    const user = await createUser("victim", "989121111111");
    await h.raw(`
      insert into payments
        (id, user_id, plan_id, months, amount_toman, amount_rial, status, attempt_id, authority)
      values
        ('${randomUUID()}', '${user.id}', 'm1', 1, 59000, 590000, 'redirected', '${randomUUID()}', 'A123');
    `);

    const response = await deleteAsAdmin(user.id, "victim");
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "payment_in_progress" });
    expect(await h.query(`select id from users where id = '${user.id}'`)).toHaveLength(1);
  });

  it("uses the exact local phone as confirmation only when the account has no username", async () => {
    const user = await createUser(null, "989123333333");
    expect((await deleteAsAdmin(user.id, "989123333333")).statusCode).toBe(400);

    const response = await deleteAsAdmin(user.id, "09123333333");
    expect(response.statusCode).toBe(200);
    expect(await h.query(`select id from users where id = '${user.id}'`)).toHaveLength(0);
  });
});
