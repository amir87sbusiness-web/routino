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

async function startTrial(access: string) {
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/subscriptions/trial/start",
    headers: auth(access),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { entitlement: { expiresAt: string } };
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
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/payments/quote",
      payload: { planId: "m1" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("prices from the database and validates codes server-side", async () => {
    await h.raw(`insert into discounts (code, percent) values ('OFF20', 20)`);
    const { access } = await signIn();

    const plain = await h.app.inject({
      method: "POST",
      url: "/v1/payments/quote",
      headers: auth(access),
      payload: { planId: "m3" },
    });
    expect(plain.json().quote.finalToman).toBe(149000);

    const coded = await h.app.inject({
      method: "POST",
      url: "/v1/payments/quote",
      headers: auth(access),
      payload: { planId: "m3", code: "off20" },
    });
    expect(coded.json().quote.finalToman).toBe(119200);
    expect(coded.json().discount.valid).toBe(true);

    const bad = await h.app.inject({
      method: "POST",
      url: "/v1/payments/quote",
      headers: auth(access),
      payload: { planId: "m3", code: "NOPE" },
    });
    expect(bad.json().quote.finalToman).toBe(149000);
    expect(bad.json().discount.reason).toBe("unknown");
  });
});

describe("checkout → gateway → callback", () => {
  it("completes a payment and grants the plan exactly once", async () => {
    const { access, user } = await signIn();
    const trial = await startTrial(access);
    const res = await checkout(access, { planId: "m3", platform: "web" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      free: boolean;
      paymentId: string;
      trackId: number;
      paymentUrl: string;
    };
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
    const status = await h.app.inject({
      method: "GET",
      url: `/v1/payments/${body.paymentId}`,
      headers: auth(access),
    });
    const after = Date.parse(status.json().entitlement.expiresAt);
    const trialEnd = Date.parse(trial.entitlement.expiresAt);
    expect(after).toBeGreaterThan(trialEnd + 85 * DAY);

    const grants = await h.query<{ source: string }>(
      `select source from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("is idempotent: a replayed callback cannot double-grant", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      trackId: number;
      paymentId: string;
    };

    const first = await settleAndCallback(body.trackId, "paid");
    expect(first.body).toContain("پرداخت موفق");
    // Replay the exact same callback (user refreshes the page / Zibal retries).
    const replayUrl = `/v1/payments/callback?trackId=${body.trackId}&success=1&status=2&orderId=${body.paymentId}`;
    const second = await h.app.inject({ method: "GET", url: replayUrl });
    expect(second.body).toContain("پرداخت موفق");

    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("never trusts success=1 from the URL: unsettled payment stays ungranted", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      trackId: number;
      paymentId: string;
    };

    // Forged callback before the user actually paid at the gateway.
    const forged = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?trackId=${body.trackId}&success=1&status=2&orderId=${body.paymentId}`,
    });
    expect(forged.body).toContain("در حال بررسی"); // pending page, no grant

    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(0);

    // And the REAL payment still works afterwards — the forgery didn't poison it.
    const real = await settleAndCallback(body.trackId, "paid");
    expect(real.body).toContain("پرداخت موفق");
  });

  it("cancel at the gateway marks the payment canceled and grants nothing", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      trackId: number;
      paymentId: string;
    };

    const cb = await settleAndCallback(body.trackId, "canceled");
    expect(cb.body).toContain("لغو");

    const [p] = await h.query<{ status: string }>(
      `select status from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("canceled");
    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(0);
  });

  it("ignores a cancel claim from someone who only guessed the trackId", async () => {
    // `trackId` is a short sequential integer handed to every paying user, so a
    // stranger can guess one. `canceled` is terminal — the status poll never
    // revives it — so honouring an unproven cancel let an attacker strand a
    // payment: the victim paid, their own callback never landed, and the poll
    // refused to heal the row. Money moved, nothing granted.
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      trackId: number;
      paymentId: string;
    };

    // No auth, no orderId, no Authority — just the guessed trackId.
    const attack = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?trackId=${body.trackId}`,
    });
    expect(attack.statusCode).toBe(200);

    const [p] = await h.query<{ status: string }>(
      `select status from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("redirected"); // untouched — the attacker proved nothing

    // And nothing about the payment leaks back: `paymentId` is the very token
    // that would have made the next attempt "proven".
    expect(attack.body).not.toContain(body.paymentId);

    // The victim really pays, but their browser never makes it back. The poll
    // must still be able to heal it.
    h.psp._settle(body.trackId, "paid");
    const poll = await h.app.inject({
      method: "GET",
      url: `/v1/payments/${body.paymentId}`,
      headers: auth(access),
    });
    expect(poll.json().payment.status).toBe("paid");

    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("survives a duplicated query param and stays a neutral page", async () => {
    // A repeated key parses to an ARRAY, not a string. `orderId.toLowerCase()`
    // then threw a TypeError -> 500. Worse, the throw only happened once the
    // trackId matched a real row, so the 500 was itself an existence oracle.
    const { access } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      trackId: number;
      paymentId: string;
    };

    const dup = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?trackId=${body.trackId}&orderId=a&orderId=b`,
    });
    expect(dup.statusCode).toBe(200);

    const [p] = await h.query<{ status: string }>(
      `select status from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("redirected"); // proved nothing, so nothing was written
  });

  it("gives a real and a nonexistent trackId the identical unproven answer", async () => {
    // Otherwise the callback is an existence oracle: walking sequential trackIds
    // and diffing the page tells a stranger which ones are real payments, i.e. a
    // live read on sales volume.
    const { access } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as { trackId: number };

    const real = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?trackId=${body.trackId}`,
    });
    const miss = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?trackId=987654321`,
    });

    expect(real.statusCode).toBe(miss.statusCode);
    expect(real.body).toBe(miss.body);
  });

  it("does not disclose a stranger's paid payment to a guessed trackId", async () => {
    // The result page prints the bank tracking code (`refNumber`) on a paid
    // outcome, and the callback is public. Naming a trackId must not be enough
    // to read someone else's payment back.
    const { access } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      trackId: number;
      paymentId: string;
    };
    await settleAndCallback(body.trackId, "paid"); // genuine callback, carries orderId

    const [paid] = await h.query<{ ref_number: string }>(
      `select ref_number from payments where id = '${body.paymentId}'`,
    );

    const snoop = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?trackId=${body.trackId}&success=1&status=2`,
    });
    expect(snoop.body).not.toContain(paid!.ref_number);
    expect(snoop.body).not.toContain(body.paymentId);
  });

  it("refuses to grant when the verified amount differs from what we charged", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m12" })).json() as {
      trackId: number;
      paymentId: string;
    };

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
    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
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
      trackId: number;
      paymentId: string;
      amountToman: number;
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
    const [d] = await h.query<{ used_count: number }>(
      `select used_count from discounts where code = 'OFF20'`,
    );
    expect(d!.used_count).toBe(1);

    // Same user, same code again → server refuses it in the quote.
    const again = await h.app.inject({
      method: "POST",
      url: "/v1/payments/quote",
      headers: auth(access),
      payload: { planId: "m1", code: "OFF20" },
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

describe("grant durability", () => {
  it("does not double-grant when discount bookkeeping fails after the grant landed", async () => {
    // `redeemDiscount` used to run inside applyPaid's un-claim catch. A failure
    // there rewound `applied_at` on a grant that had ALREADY succeeded, and the
    // retry re-ran grantInterval — which is not idempotent (grants.payment_id has
    // no unique constraint) — so one payment extended the user's expiry twice.
    await h.raw(`insert into discounts (code, percent) values ('HALF', 50)`);
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1", code: "HALF" })).json() as {
      trackId: number;
      paymentId: string;
    };

    // Break the redemptions FK so redeemDiscount throws, without touching the
    // grant path at all.
    await h.raw(`delete from discounts where code = 'HALF'`);

    await settleAndCallback(body.trackId, "paid");

    const [p] = await h.query<{ status: string; applied_at: string | null }>(
      `select status, applied_at from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("paid");
    expect(p!.applied_at).not.toBeNull(); // stayed claimed — no retry window

    // Poll again, the way the app does on return. This is where the retry used
    // to fire a second grantInterval.
    await h.app.inject({
      method: "GET",
      url: `/v1/payments/${body.paymentId}`,
      headers: auth(access),
    });

    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });
});

describe("GET /v1/payments/:id", () => {
  it("self-heals a paid-but-never-called-back payment", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      trackId: number;
      paymentId: string;
    };

    // User paid, then the callback never reached us (closed tab, network).
    h.psp._settle(body.trackId, "paid");

    const res = await h.app.inject({
      method: "GET",
      url: `/v1/payments/${body.paymentId}`,
      headers: auth(access),
    });
    expect(res.json().payment.status).toBe("paid");
    expect(res.json().entitlement.status).toBe("active");
    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("recovers a payment whose grant failed after the money moved", async () => {
    // Regression, and the worst outcome in the codebase: when granting threw,
    // applyPaid un-claimed `applied_at` for a retry but left `status = 'paid'`.
    // The recovery branch only re-verified rows still marked `redirected`, so
    // the payment showed "paid" forever with no subscription behind it.
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      trackId: number;
      paymentId: string;
    };
    h.psp._settle(body.trackId, "paid");
    await h.raw(
      `update payments set status = 'paid', applied_at = null, verified_at = now(), paid_at = now()
       where id = '${body.paymentId}'`,
    );

    const res = await h.app.inject({
      method: "GET",
      url: `/v1/payments/${body.paymentId}`,
      headers: auth(access),
    });
    expect(res.json().payment.status).toBe("paid");
    expect(res.json().entitlement.status).toBe("active");
    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("never re-verifies a cancelled or amount-mismatched payment", async () => {
    // The flip side of widening the recovery branch: these two states must stay
    // terminal. A mismatch is a fraud signal, and a cancel must not be revived.
    const { access, user } = await signIn();
    for (const status of ["canceled", "verify_failed"]) {
      const body = (await checkout(access, { planId: "m1" })).json() as {
        trackId: number;
        paymentId: string;
      };
      h.psp._settle(body.trackId, "paid"); // gateway WOULD say paid if asked
      await h.raw(`update payments set status = '${status}' where id = '${body.paymentId}'`);
      const res = await h.app.inject({
        method: "GET",
        url: `/v1/payments/${body.paymentId}`,
        headers: auth(access),
      });
      expect(res.json().payment.status).toBe(status);
    }
    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(0);
  });

  it("hides other users' payments", async () => {
    const { access } = await signIn("09123334444");
    const body = (await checkout(access, { planId: "m1" })).json() as { paymentId: string };
    const other = await signIn("09351112222");
    const res = await h.app.inject({
      method: "GET",
      url: `/v1/payments/${body.paymentId}`,
      headers: auth(other.access),
    });
    expect(res.statusCode).toBe(404);
  });
});
