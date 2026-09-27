import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminSignIn, makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});
const headers = (access: string) => ({ authorization: `Bearer ${access}` });
async function signIn(phone: string) {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { access: string; user: { id: string } };
}
async function summary(access: string) {
  const res = await h.app.inject({
    method: "GET",
    url: "/v1/referrals/me",
    headers: headers(access),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}
async function checkout(access: string, code?: string) {
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/payments/checkout",
    headers: headers(access),
    payload: { planId: "m1", attemptId: crypto.randomUUID(), code },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}
async function settle(authority: string, outcome: "paid" | "canceled") {
  const gateway = await h.app.inject({
    method: "GET",
    url: `/v1/dev/gateway/settle?Authority=${authority}&outcome=${outcome}`,
  });
  expect(gateway.statusCode).toBe(302);
  const path = gateway.headers.location!.replace(h.env.PUBLIC_API_URL, "");
  const callback = await h.app.inject({ method: "GET", url: path });
  expect(callback.statusCode).toBe(200);
  return path;
}

describe("referral HTTP flow with isolated PostgreSQL and a fake bank", () => {
  it("claims without rewards, excludes trial/FREE/failure, rewards first paid purchase and exposes both sides to user/admin without duplicates", async () => {
    const a = await signIn("09121112231");
    const b = await signIn("09121112232");
    const admin = await adminSignIn(h);
    const code = (await summary(a.access)).referralCode;
    const claim = await h.app.inject({
      method: "POST",
      url: "/v1/referrals/claim",
      headers: headers(b.access),
      payload: { code },
    });
    expect(claim.statusCode).toBe(200);
    for (const user of [a, b]) {
      const trial = await h.app.inject({
        method: "POST",
        url: "/v1/subscriptions/trial/start",
        headers: headers(user.access),
      });
      expect(trial.statusCode).toBe(200);
      expect(await summary(user.access)).toMatchObject({ earnedDays: 0, successfulInvites: 0 });
    }
    expect(await h.query("select * from grants where source='referral'")).toHaveLength(0);
    await h.raw("insert into discounts (code, percent) values ('FREEALL', 100)");
    expect((await checkout(b.access, "FREEALL")).free).toBe(true);
    const failed = await checkout(b.access);
    await settle(failed.authority, "canceled");
    expect(await h.query("select * from grants where source='referral'")).toHaveLength(0);
    const first = await checkout(b.access);
    const callback = await settle(first.authority, "paid");
    expect(await summary(a.access)).toMatchObject({ earnedDays: 7, successfulInvites: 1 });
    expect(await summary(b.access)).toMatchObject({
      earnedDays: 7,
      successfulInvites: 0,
      claimState: { status: "claimed", rewarded: true },
    });
    const rewards = await h.query<{ user_id: string; delta: number; expires_after: Date }>(
      "select user_id, extract(epoch from expires_after - expires_before)::int as delta, expires_after from grants where source='referral'",
    );
    expect(rewards).toHaveLength(2);
    expect(rewards.map((r) => r.delta)).toEqual([604800, 604800]);
    for (const user of [a, b]) {
      const detail = await h.app.inject({
        method: "GET",
        url: `/v1/admin/users/${user.user.id}`,
        headers: admin,
      });
      expect(detail.statusCode).toBe(200);
      expect(
        detail.json().grants.filter((g: { source: string }) => g.source === "referral"),
      ).toHaveLength(1);
      const account = await h.app.inject({
        method: "GET",
        url: "/v1/auth/account",
        headers: headers(user.access),
      });
      expect(account.json().referral.earnedDays).toBe(7);
      const reward = rewards.find((r) => r.user_id === user.user.id)!;
      expect(new Date(detail.json().entitlement.expiresAt).getTime()).toBe(
        new Date(reward.expires_after).getTime(),
      );
    }
    const snapshot = await h.query(
      "select user_id, plan_id, expires_at from entitlements order by user_id",
    );
    for (let i = 0; i < 3; i++)
      expect((await h.app.inject({ method: "GET", url: callback })).statusCode).toBe(200);
    expect(
      await h.query("select user_id, plan_id, expires_at from entitlements order by user_id"),
    ).toEqual(snapshot);
    const second = await checkout(b.access);
    await settle(second.authority, "paid");
    expect(await h.query("select * from grants where source='referral'")).toHaveLength(2);
    expect(await summary(a.access)).toMatchObject({ earnedDays: 7, successfulInvites: 1 });
    expect(await summary(b.access)).toMatchObject({ earnedDays: 7, successfulInvites: 0 });
  });
});
