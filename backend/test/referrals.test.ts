import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claimReferralCode, ensureReferralCode } from "../src/services/referral.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

async function signIn(phone: string) {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const response = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  return response.json() as { access: string; user: { id: string } };
}

const authorized = (access: string) => ({ authorization: `Bearer ${access}` });

const getSnapshot = (access: string) =>
  h.app.inject({ method: "GET", url: "/v1/referrals/me", headers: authorized(access) });

const refreshSnapshot = (access: string) =>
  h.app.inject({ method: "POST", url: "/v1/referrals/me/refresh", headers: authorized(access) });

const getSummary = async (access: string) => {
  const response = await getSnapshot(access);
  return { json: () => response.json() };
};

const claim = (access: string, code: string) =>
  h.app.inject({
    method: "POST",
    url: "/v1/referrals/claim",
    headers: authorized(access),
    payload: { code },
  });

describe("referral routes", () => {
  it("requires authentication without disclosing referral data", async () => {
    expect((await h.app.inject({ method: "GET", url: "/v1/referrals/me" })).statusCode).toBe(401);
    expect(
      (await h.app.inject({ method: "POST", url: "/v1/referrals/me/refresh" })).statusCode,
    ).toBe(401);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/referrals/claim",
          payload: { code: "ABCDEF" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("refreshes the canonical summary and entitlement through a non-cacheable POST", async () => {
    const { access } = await signIn("09121110023");
    const response = await refreshSnapshot(access);

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      referralCode: expect.stringMatching(/^[A-Z]{6}$/),
      rewardDays: 7,
      successfulInvites: 0,
      earnedDays: 0,
      entitlement: { status: "none", planId: null },
    });
  });

  it("returns the canonical referral summary and current entitlement in one request", async () => {
    const { access } = await signIn("09121110001");
    const first = (await getSnapshot(access)).json();
    const second = (await getSnapshot(access)).json();

    expect((await getSnapshot(access)).headers["cache-control"]).toBe("no-store");

    expect(first).toEqual({
      referralCode: expect.stringMatching(/^[A-Z]{6}$/),
      rewardDays: 7,
      successfulInvites: 0,
      earnedDays: 0,
      claimState: { status: "eligible" },
      entitlement: {
        status: "none",
        planId: null,
        startedAt: null,
        expiresAt: null,
        issuedAt: expect.any(String),
        deletionAt: expect.any(String),
      },
    });
    expect(second).toMatchObject({
      referralCode: first.referralCode,
      rewardDays: 7,
      successfulInvites: 0,
      earnedDays: 0,
      claimState: { status: "eligible" },
    });
    expect(Object.keys(first).sort()).toEqual(
      [
        "claimState",
        "earnedDays",
        "entitlement",
        "referralCode",
        "rewardDays",
        "successfulInvites",
      ].sort(),
    );
  });

  it("retries a unique-code collision without changing the first user's code", async () => {
    const firstUser = await signIn("09121110012");
    const secondUser = await signIn("09121110013");
    let fills = 0;
    const random = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.fill(fills < 2 ? 0 : 1);
      fills += 1;
      return array;
    });
    try {
      const first = (await getSummary(firstUser.access)).json().referralCode;
      const second = (await getSummary(secondUser.access)).json().referralCode;
      expect(first).toBe("AAAAAA");
      expect(second).toBe("BBBBBB");
      expect(fills).toBeGreaterThanOrEqual(3);
    } finally {
      random.mockRestore();
    }
  });

  it("fails after the bounded number of referral-code collision retries", async () => {
    const occupied = await signIn("09121110014");
    const target = await signIn("09121110015");
    await h.raw(`update users set referral_code = 'AAAAAA' where id = '${occupied.user.id}'`);
    const generate = vi.fn(() => "AAAAAA");

    await expect(ensureReferralCode(h.db, target.user.id, generate)).rejects.toThrow(
      "could not allocate a unique referral code",
    );
    expect(generate).toHaveBeenCalledTimes(8);
  });

  it("returns one durable code from concurrent lazy assignments", async () => {
    const user = await signIn("09121110016");
    const assigned = await Promise.all([
      ensureReferralCode(h.db, user.user.id, () => "BBBBBB"),
      ensureReferralCode(h.db, user.user.id, () => "CCCCCC"),
      ensureReferralCode(h.db, user.user.id, () => "DDDDDD"),
    ]);
    expect(new Set(assigned).size).toBe(1);
    const [stored] = await h.query<{ referral_code: string }>(
      `select referral_code from users where id = '${user.user.id}'`,
    );
    expect(stored!.referral_code).toBe(assigned[0]);
  });

  it("normalizes a valid code, claims it once, and rejects changing inviters", async () => {
    const inviter = await signIn("09121110002");
    const invitee = await signIn("09121110003");
    const other = await signIn("09121110004");
    const inviterCode = (await getSummary(inviter.access)).json().referralCode as string;
    const otherCode = (await getSummary(other.access)).json().referralCode as string;

    const first = await claim(invitee.access, `  ${inviterCode.toLowerCase()}  `);
    expect(first.statusCode).toBe(200);
    expect(first.json().claimState).toEqual({ status: "claimed" });
    const replay = await claim(invitee.access, inviterCode);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().claimState).toEqual({ status: "claimed" });

    const changed = await claim(invitee.access, otherCode);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toBe("referral_already_claimed");
  });

  it("rejects malformed, unknown, and self referral codes with stable errors", async () => {
    const user = await signIn("09121110005");
    const ownCode = (await getSummary(user.access)).json().referralCode as string;
    const unknownCode = ownCode === "ZZZZZZ" ? "YYYYYY" : "ZZZZZZ";

    for (const code of ["ABCDE", "ABC123", unknownCode]) {
      const response = await claim(user.access, code);
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("invalid_referral_code");
    }
    const self = await claim(user.access, ownCode);
    expect(self.statusCode).toBe(400);
    expect(self.json().error).toBe("self_referral");
  });

  it("rejects accounts created before rollout", async () => {
    const inviter = await signIn("09121110006");
    const invitee = await signIn("09121110007");
    const inviterCode = (await getSummary(inviter.access)).json().referralCode as string;
    await h.raw(`
      update referral_program_policy set started_at = now() where key = 'referral_v1';
      update users set created_at = now() - interval '1 day' where id = '${invitee.user.id}';
    `);

    const summary = (await getSummary(invitee.access)).json();
    expect(summary.claimState).toEqual({
      status: "ineligible",
      reason: "account_predates_program",
    });
    const response = await claim(invitee.access, inviterCode);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("referral_not_eligible");
  });

  it("compares account and rollout timestamps in PostgreSQL microsecond precision", async () => {
    const invitee = await signIn("09121110017");
    await h.raw(`
      update referral_program_policy
         set started_at = '2026-09-26T00:00:00.000750Z'
       where key = 'referral_v1';
      update users
         set created_at = '2026-09-26T00:00:00.000500Z'
       where id = '${invitee.user.id}';
    `);

    expect((await getSummary(invitee.access)).json().claimState).toEqual({
      status: "ineligible",
      reason: "account_predates_program",
    });
  });

  it("rejects an account with an existing verified positive bank purchase", async () => {
    const inviter = await signIn("09121110008");
    const invitee = await signIn("09121110009");
    const inviterCode = (await getSummary(inviter.access)).json().referralCode as string;
    await h.raw(`
      insert into payments
        (user_id, plan_id, months, amount_toman, amount_rial, status, authority,
         psp_result, applied_at)
      values
        ('${invitee.user.id}', 'm1', 1, 59000, 590000, 'paid', 'BANK-PAID-1', 100, now())
    `);

    const summary = (await getSummary(invitee.access)).json();
    expect(summary.claimState).toEqual({ status: "ineligible", reason: "paid_purchase_exists" });
    const response = await claim(invitee.access, inviterCode);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("referral_not_eligible");
  });

  it.each([
    ["zero amount", "0", "'BANK-NEG-1'", "100", "now()", "'paid'"],
    ["null authority", "59000", "null", "100", "now()", "'paid'"],
    ["blank authority", "59000", "'   '", "100", "now()", "'paid'"],
    ["synthetic authority", "59000", "'FREE'", "100", "now()", "'paid'"],
    ["non-success PSP result", "59000", "'BANK-NEG-2'", "-51", "now()", "'paid'"],
    ["unapplied payment", "59000", "'BANK-NEG-3'", "100", "null", "'paid'"],
    ["non-paid status", "59000", "'BANK-NEG-4'", "100", "now()", "'failed'"],
  ])(
    "keeps claim eligibility for a %s payment row",
    async (_label, amount, authority, psp, applied, status) => {
      const invitee = await signIn("09121110018");
      await h.raw(`
      insert into payments
        (user_id, plan_id, months, amount_toman, amount_rial, status, authority,
         psp_result, applied_at)
      values
        ('${invitee.user.id}', 'm1', 1, ${amount}, 590000, ${status}, ${authority}, ${psp}, ${applied})
    `);

      expect((await getSummary(invitee.access)).json().claimState).toEqual({ status: "eligible" });
    },
  );

  it("serializes competing inviter claims for one invitee", async () => {
    const firstInviter = await signIn("09121110019");
    const secondInviter = await signIn("09121110020");
    const invitee = await signIn("09121110021");
    const firstCode = (await getSummary(firstInviter.access)).json().referralCode as string;
    const secondCode = (await getSummary(secondInviter.access)).json().referralCode as string;

    const results = await Promise.allSettled([
      claimReferralCode(h.db, invitee.user.id, firstCode, new Date()),
      claimReferralCode(h.db, invitee.user.id, secondCode, new Date()),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ statusCode: 409, code: "referral_already_claimed" });
    expect(
      await h.query(`select id from referrals where invitee_id = '${invitee.user.id}'`),
    ).toHaveLength(1);
  });

  it("maps every overlong string to the referral domain error", async () => {
    const user = await signIn("09121110022");
    const response = await claim(user.access, "A".repeat(65));
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_referral_code");
  });

  it("derives successful and earned totals from successful referral rows", async () => {
    const inviter = await signIn("09121110010");
    const invitee = await signIn("09121110011");
    const inviterCode = (await getSummary(inviter.access)).json().referralCode as string;
    await claim(invitee.access, inviterCode);
    await h.raw(`
      with payment as (
        insert into payments
          (user_id, plan_id, months, amount_toman, amount_rial, status, authority,
           psp_result, applied_at)
        values
          ('${invitee.user.id}', 'm1', 1, 59000, 590000, 'paid', 'BANK-PAID-2', 100, now())
        returning id
      )
      update referrals
         set successful_payment_id = payment.id, successful_at = now()
        from payment
       where invitee_id = '${invitee.user.id}'
    `);

    expect((await getSummary(inviter.access)).json()).toMatchObject({
      successfulInvites: 1,
      earnedDays: 7,
    });

    const account = await h.app.inject({
      method: "GET",
      url: "/v1/auth/account",
      headers: authorized(inviter.access),
    });
    expect(account.statusCode).toBe(200);
    expect(account.json().referral).toMatchObject({
      referralCode: inviterCode,
      rewardDays: 7,
      successfulInvites: 1,
      earnedDays: 7,
    });
  });
});
