/**
 * The money path, end to end against the fake PSP — which mimics Zibal's
 * contract exactly, so everything asserted here holds against the real gateway
 * with only an env change.
 */
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

const DAY = 86_400_000;

async function signIn(phone = "09123334444") {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  return res.json() as { access: string; user: { id: string }; entitlement: { expiresAt: string } };
}

const auth = (access: string) => ({ authorization: `Bearer ${access}` });

async function checkout(access: string, body: Record<string, unknown>) {
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/payments/checkout",
    headers: auth(access),
    payload: body,
  });
  return res;
}

/** Clicks "Pay"/"Cancel" on the fake gateway and follows the redirect into the
 * callback, exactly as a browser would. Returns the callback response. */
async function settleAndCallback(trackId: number, outcome: "paid" | "canceled") {
  const settle = await h.app.inject({
    method: "GET",
    url: `/v1/dev/gateway/settle?trackId=${trackId}&outcome=${outcome}`,
  });
  expect(settle.statusCode).toBe(302);
  const location = settle.headers.location as string;
  const path = location.replace(h.env.PUBLIC_API_URL, "");
  return h.app.inject({ method: "GET", url: path });
}

describe("POST /v1/payments/quote", () => {
  it("requires auth", async () => {
    const res = await h.app.inject({ method: "POST", url: "/v1/payments/quote", payload: { planId: "m1" } });
    expect(res.statusCode).toBe(401);
  });

  it("prices from the database and validates codes server-side", async () => {
    await h.raw(`insert into discounts (code, percent) values ('OFF20', 20)`);
    const { access } = await signIn();

    const plain = await h.app.inject({
      method: "POST", url: "/v1/payments/quote", headers: auth(access), payload: { planId: "m3" },
    });
    expect(plain.json().quote.finalToman).toBe(149000);

    const coded = await h.app.inject({
      method: "POST", url: "/v1/payments/quote", headers: auth(access), payload: { planId: "m3", code: "off20" },
    });
    expect(coded.json().quote.finalToman).toBe(119200);
    expect(coded.json().discount.valid).toBe(true);

    const bad = await h.app.inject({
      method: "POST", url: "/v1/payments/quote", headers: auth(access), payload: { planId: "m3", code: "NOPE" },
    });
    expect(bad.json().quote.finalToman).toBe(149000);
    expect(bad.json().discount.reason).toBe("unknown");
  });
});

describe("checkout → gateway → callback", () => {
  it("completes a payment and grants the plan exactly once", async () => {
    const { access, user, entitlement } = await signIn();
    const res = await checkout(access, { planId: "m3", platform: "web" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { free: boolean; paymentId: string; trackId: number; paymentUrl: string };
    expect(body.free).toBe(false);
    expect(body.paymentUrl).toContain("/v1/dev/gateway?trackId=");

    const cb = await settleAndCallback(body.trackId, "paid");
    expect(cb.statusCode).toBe(200);
    expect(cb.body).toContain("پرداخت موفق");

    const [p] = await h.query<{ status: string; applied_at: string | null; ref_number: string }>(
      `select status, applied_at, ref_number from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("paid");
    expect(p!.applied_at).not.toBeNull();
    expect(p!.ref_number).toContain("FAKE-");

    // 3 calendar months stacked on the trial's remaining days, not replacing them.
    const status = await h.app.inject({ method: "GET", url: `/v1/payments/${body.paymentId}`, headers: auth(access) });
    const after = Date.parse(status.json().entitlement.expiresAt);
    const trialEnd = Date.parse(entitlement.expiresAt);
    expect(after).toBeGreaterThan(trialEnd + 85 * DAY);

    const grants = await h.query<{ source: string }>(
      `select source from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("is idempotent: a replayed callback cannot double-grant", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as { trackId: number; paymentId: string };

    const first = await settleAndCallback(body.trackId, "paid");
    expect(first.body).toContain("پرداخت موفق");
    // Replay the exact same callback (user refreshes the page / Zibal retries).
    const replayUrl = `/v1/payments/callback?trackId=${body.trackId}&success=1&status=2&orderId=${body.paymentId}`;
    const second = await h.app.inject({ method: "GET", url: replayUrl });
    expect(second.body).toContain("پرداخت موفق");

    const grants = await h.query(`select id from grants where user_id = '${user.id}' and source = 'payment'`);
    expect(grants).toHaveLength(1);
  });

  it("never trusts success=1 from the URL: unsettled payment stays ungranted", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as { trackId: number; paymentId: string };

    // Forged callback before the user actually paid at the gateway.
    const forged = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?trackId=${body.trackId}&success=1&status=2&orderId=${body.paymentId}`,
    });
    expect(forged.body).toContain("در حال بررسی"); // pending page, no grant

    const grants = await h.query(`select id from grants where user_id = '${user.id}' and source = 'payment'`);
    expect(grants).toHaveLength(0);

    // And the REAL payment still works afterwards — the forgery didn't poison it.
    const real = await settleAndCallback(body.trackId, "paid");
    expect(real.body).toContain("پرداخت موفق");
  });

  it("cancel at the gateway marks the payment canceled and grants nothing", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as { trackId: number; paymentId: string };

    const cb = await settleAndCallback(body.trackId, "canceled");
    expect(cb.body).toContain("لغو");

    const [p] = await h.query<{ status: string }>(`select status from payments where id = '${body.paymentId}'`);
    expect(p!.status).toBe("canceled");
    const grants = await h.query(`select id from grants where user_id = '${user.id}' and source = 'payment'`);
    expect(grants).toHaveLength(0);
  });

  it("refuses to grant when the verified amount differs from what we charged", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m12" })).json() as { trackId: number; paymentId: string };

    // Tamper: the gateway "saw" a different amount than our payment row.
    h.psp._txns.get(body.trackId)!.amountRial = 1_000_000;
    const cb = await settleAndCallback(body.trackId, "paid");
    expect(cb.statusCode).toBe(200);
    expect(cb.body).not.toContain("پرداخت موفق");

    const [p] = await h.query<{ status: string; applied_at: string | null }>(
      `select status, applied_at from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("verify_failed");
    expect(p!.applied_at).toBeNull();
    const grants = await h.query(`select id from grants where user_id = '${user.id}' and source = 'payment'`);
    expect(grants).toHaveLength(0);
  });

  it("rejects an unknown or inactive plan", async () => {
    const { access } = await signIn();
    expect((await checkout(access, { planId: "m99" })).statusCode).toBe(404);
  });

  it("rate-limits checkout creation", async () => {
    const { access } = await signIn();
    for (let i = 0; i < 10; i++) {
      expect((await checkout(access, { planId: "m1" })).statusCode).toBe(200);
    }
    expect((await checkout(access, { planId: "m1" })).statusCode).toBe(429);
  });
});

describe("discount redemption", () => {
  it("burns the code only after a successful payment, once per user", async () => {
    await h.raw(`insert into discounts (code, percent, max_uses) values ('OFF20', 20, 10)`);
    const { access, user } = await signIn();

    const body = (await checkout(access, { planId: "m3", code: "OFF20" })).json() as {
      trackId: number; paymentId: string; amountToman: number;
    };
    expect(body.amountToman).toBe(119200); // server-computed, discounted

    // Not redeemed yet — an abandoned checkout must not burn a use.
    expect(await h.query(`select * from redemptions where user_id = '${user.id}'`)).toHaveLength(0);

    await settleAndCallback(body.trackId, "paid");

    const redemptions = await h.query<{ code: string; payment_id: string }>(
      `select code, payment_id from redemptions where user_id = '${user.id}'`,
    );
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]!.code).toBe("OFF20");
    const [d] = await h.query<{ used_count: number }>(`select used_count from discounts where code = 'OFF20'`);
    expect(d!.used_count).toBe(1);

    // Same user, same code again → server refuses it in the quote.
    const again = await h.app.inject({
      method: "POST", url: "/v1/payments/quote", headers: auth(access), payload: { planId: "m1", code: "OFF20" },
    });
    expect(again.json().discount.reason).toBe("already_used");
  });

  it("grants a 100% discount directly without touching the gateway", async () => {
    await h.raw(`insert into discounts (code, percent) values ('FREE100', 100)`);
    const { access, user } = await signIn();

    const res = await checkout(access, { planId: "m1", code: "FREE100" });
    const body = res.json() as { free: boolean; entitlement: { status: string } };
    expect(body.free).toBe(true);
    expect(body.entitlement.status).toBe("active");

    const [p] = await h.query<{ status: string; amount_toman: number; track_id: number | null }>(
      `select status, amount_toman, track_id from payments where user_id = '${user.id}'`,
    );
    expect(p!.status).toBe("paid");
    expect(p!.amount_toman).toBe(0);
    expect(p!.track_id).toBeNull(); // never went near the PSP
    expect(await h.query(`select * from redemptions where user_id = '${user.id}'`)).toHaveLength(1);
  });
});

describe("GET /v1/payments/:id", () => {
  it("self-heals a paid-but-never-called-back payment", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as { trackId: number; paymentId: string };

    // User paid, then the callback never reached us (closed tab, network).
    h.psp._settle(body.trackId, "paid");

    const res = await h.app.inject({ method: "GET", url: `/v1/payments/${body.paymentId}`, headers: auth(access) });
    expect(res.json().payment.status).toBe("paid");
    expect(res.json().entitlement.status).toBe("active");
    const grants = await h.query(`select id from grants where user_id = '${user.id}' and source = 'payment'`);
    expect(grants).toHaveLength(1);
  });

  it("recovers a payment whose grant failed after the money moved", async () => {
    // Regression, and the worst outcome in the codebase: when granting threw,
    // applyPaid un-claimed `applied_at` for a retry but left `status = 'paid'`.
    // The recovery branch only re-verified rows still marked `redirected`, so
    // the payment showed "paid" forever with no subscription behind it.
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as { trackId: number; paymentId: string };
    h.psp._settle(body.trackId, "paid");
    await h.raw(
      `update payments set status = 'paid', applied_at = null, verified_at = now(), paid_at = now()
       where id = '${body.paymentId}'`,
    );

    const res = await h.app.inject({ method: "GET", url: `/v1/payments/${body.paymentId}`, headers: auth(access) });
    expect(res.json().payment.status).toBe("paid");
    expect(res.json().entitlement.status).toBe("active");
    const grants = await h.query(`select id from grants where user_id = '${user.id}' and source = 'payment'`);
    expect(grants).toHaveLength(1);
  });

  it("never re-verifies a cancelled or amount-mismatched payment", async () => {
    // The flip side of widening the recovery branch: these two states must stay
    // terminal. A mismatch is a fraud signal, and a cancel must not be revived.
    const { access, user } = await signIn();
    for (const status of ["canceled", "verify_failed"]) {
      const body = (await checkout(access, { planId: "m1" })).json() as { trackId: number; paymentId: string };
      h.psp._settle(body.trackId, "paid"); // gateway WOULD say paid if asked
      await h.raw(`update payments set status = '${status}' where id = '${body.paymentId}'`);
      const res = await h.app.inject({ method: "GET", url: `/v1/payments/${body.paymentId}`, headers: auth(access) });
      expect(res.json().payment.status).toBe(status);
    }
    const grants = await h.query(`select id from grants where user_id = '${user.id}' and source = 'payment'`);
    expect(grants).toHaveLength(0);
  });

  it("hides other users' payments", async () => {
    const { access } = await signIn("09123334444");
    const body = (await checkout(access, { planId: "m1" })).json() as { paymentId: string };
    const other = await signIn("09351112222");
    const res = await h.app.inject({
      method: "GET", url: `/v1/payments/${body.paymentId}`, headers: auth(other.access),
    });
    expect(res.statusCode).toBe(404);
  });
});
