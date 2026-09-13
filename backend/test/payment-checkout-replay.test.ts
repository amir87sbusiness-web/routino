import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  h.psp._txns.clear();
});

afterAll(async () => {
  await h?.close();
});

const auth = (access: string) => ({ authorization: `Bearer ${access}` });

async function signIn(phone = "09124445566") {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  return res.json() as { access: string };
}

describe("completed checkout replay", () => {
  it("returns current entitlement instead of the old StartPay URL", async () => {
    const { access } = await signIn();
    const attemptId = crypto.randomUUID();

    const first = await h.app.inject({
      method: "POST",
      url: "/v1/payments/checkout",
      headers: auth(access),
      payload: { planId: "m1", platform: "android", attemptId },
    });
    expect(first.statusCode).toBe(200);
    const created = first.json() as {
      paymentId: string;
      authority: string;
      paymentUrl: string;
    };
    expect(created.paymentUrl).toBeTruthy();

    h.psp._settle(created.authority, "paid");
    const callback = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${created.paymentId}&Authority=${created.authority}&Status=OK`,
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.body).toContain("پرداخت موفق");

    const replay = await h.app.inject({
      method: "POST",
      url: "/v1/payments/checkout",
      headers: auth(access),
      payload: { planId: "m1", platform: "android", attemptId },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      free: true,
      paymentId: created.paymentId,
      entitlement: { status: "active" },
    });
    expect(replay.json()).not.toHaveProperty("paymentUrl");
    expect(replay.json()).not.toHaveProperty("authority");

    const [grantCount] = await h.query<{ count: number }>(`
      select count(*)::int as count from grants where payment_id='${created.paymentId}'
    `);
    expect(Number(grantCount?.count)).toBe(1);
  });
});
