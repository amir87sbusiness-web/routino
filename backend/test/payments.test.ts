/**
 * The money path, end to end against a ZarinPal-shaped fake provider.
 * with only an env change.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { schema } from "../src/db/schema.js";
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
    payload: { attemptId: crypto.randomUUID(), ...body },
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
async function settleAndCallback(authority: string, outcome: "paid" | "canceled") {
  const settle = await h.app.inject({
    method: "GET",
    url: `/v1/dev/gateway/settle?Authority=${authority}&outcome=${outcome}`,
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
  it("returns the same redirect and makes one PSP call when an attempt is retried", async () => {
    const { access, user } = await signIn();
    const attemptId = crypto.randomUUID();

    const first = await checkout(access, { planId: "m1", attemptId });
    const second = await checkout(access, { planId: "m1", attemptId });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      paymentId: first.json().paymentId,
      paymentUrl: first.json().paymentUrl,
    });
    expect(h.psp._txns.size).toBe(1);
    const rows = await h.query<{
      attempt_id: string;
      authority: string;
      status: string;
    }>(`select attempt_id, authority, status from payments where user_id = '${user.id}'`);
    expect(rows).toEqual([
      expect.objectContaining({
        attempt_id: attemptId,
        authority: expect.any(String),
        status: "redirected",
      }),
    ]);
  });

  it("rejects an in-progress duplicate and changed immutable attempt inputs", async () => {
    const { access, user } = await signIn();
    const attemptId = crypto.randomUUID();
    await h.db.insert(schema.payments).values({
      userId: user.id,
      attemptId,
      planId: "m1",
      months: 1,
      amountToman: 59_000,
      amountRial: 590_000,
      platform: "web",
      status: "pending",
    });

    const pending = await checkout(access, { planId: "m1", attemptId });
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toMatchObject({ error: "duplicate_payment_attempt" });

    const changed = await checkout(access, { planId: "m3", attemptId });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ error: "duplicate_payment_attempt" });
    expect(h.psp._txns.size).toBe(0);
  });

  it("ignores a client-supplied amount and stores the server price", async () => {
    const { access, user } = await signIn();
    const res = await checkout(access, { planId: "m1", amount: 1, amountToman: 1 });
    expect(res.statusCode).toBe(200);
    const [payment] = await h.query<{ amount_toman: number; amount_rial: number }>(
      `select amount_toman, amount_rial from payments where user_id = '${user.id}'`,
    );
    expect(Number(payment?.amount_toman)).toBe(59_000);
    expect(Number(payment?.amount_rial)).toBe(590_000);
  });

  it("parks an ambiguous create without automatically calling ZarinPal twice", async () => {
    const { access, user } = await signIn();
    const attemptId = crypto.randomUUID();
    h.psp._setNextRequest("unknown");

    const first = await checkout(access, { planId: "m1", attemptId });
    const retry = await checkout(access, { planId: "m1", attemptId });

    expect(first.statusCode).toBe(503);
    expect(first.json()).toMatchObject({ error: "payment_request_unknown" });
    expect(retry.statusCode).toBe(503);
    expect(h.psp._txns.size).toBe(0);
    const [payment] = await h.query<{ status: string; authority: string | null }>(
      `select status, authority from payments where user_id = '${user.id}'`,
    );
    expect(payment).toEqual({ status: "provider_unknown", authority: null });

    const fresh = await checkout(access, { planId: "m1", attemptId: crypto.randomUUID() });
    expect(fresh.statusCode).toBe(503);
    expect(fresh.json()).toMatchObject({ error: "payment_request_unknown" });
    expect(h.psp._txns.size).toBe(0);
  });

  it("recovers when the authority callback arrives after token persistence was interrupted", async () => {
    const { access, user } = await signIn();
    const created = await checkout(access, { planId: "m1" });
    const body = created.json() as { paymentId: string; authority: string };
    h.psp._settle(body.authority, "paid");
    await h.raw(
      `update payments set authority = null, status = 'provider_unknown' where id = '${body.paymentId}'`,
    );

    const callback = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${body.paymentId}&Authority=${body.authority}&Status=OK`,
    });
    expect(callback.body).toContain("پرداخت موفق");
    const [payment] = await h.query<{ status: string; authority: string }>(
      `select status, authority from payments where id = '${body.paymentId}'`,
    );
    expect(payment).toEqual({ status: "paid", authority: body.authority });
    expect(
      await h.query(`select id from grants where user_id = '${user.id}' and source = 'payment'`),
    ).toHaveLength(1);
  });

  it("treats ZarinPal code 101 as success when local delivery still needs applying", async () => {
    const { access } = await signIn();
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      paymentId: string;
      authority: string;
    };
    const txn = h.psp._txns.get(body.authority)!;
    txn.outcome = "paid";
    txn.verifiedOnce = true;

    const callback = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${body.paymentId}&Authority=${body.authority}&Status=OK`,
    });
    expect(callback.body).toContain("پرداخت موفق");
    const [payment] = await h.query<{ status: string; applied_at: string | null }>(
      `select status, applied_at from payments where id = '${body.paymentId}'`,
    );
    expect(payment?.status).toBe("paid");
    expect(payment?.applied_at).not.toBeNull();
  });

  it("completes a payment and grants the plan exactly once", async () => {
    const { access, user } = await signIn();
    const trial = await startTrial(access);
    const res = await checkout(access, { planId: "m3", platform: "web" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      free: boolean;
      paymentId: string;
      authority: string;
      paymentUrl: string;
    };
    expect(body.free).toBe(false);
    expect(body.paymentUrl).toContain("/v1/dev/gateway?Authority=");

    const cb = await settleAndCallback(body.authority, "paid");
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
      authority: string;
      paymentId: string;
    };

    const first = await settleAndCallback(body.authority, "paid");
    expect(first.body).toContain("پرداخت موفق");
    const replayUrl = `/v1/payments/callback?paymentId=${body.paymentId}&Authority=${body.authority}&Status=OK`;
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
      authority: string;
      paymentId: string;
    };

    // Forged callback before the user actually paid at the gateway.
    const forged = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${body.paymentId}&Authority=${body.authority}&Status=OK`,
    });
    expect(forged.body).toContain("در حال بررسی"); // pending page, no grant

    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(0);

    // And the REAL payment still works afterwards — the forgery didn't poison it.
    const real = await settleAndCallback(body.authority, "paid");
    expect(real.body).toContain("پرداخت موفق");
  });

  it("renders cancellation without making a recoverable payment terminal", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      authority: string;
      paymentId: string;
    };

    const cb = await settleAndCallback(body.authority, "canceled");
    expect(cb.body).toContain("لغو");

    const [p] = await h.query<{ status: string }>(
      `select status from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("redirected");
    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(0);
  });

  it("ignores a cancel claim from someone who only guessed the authority", async () => {
    // `authority` is a short sequential integer handed to every paying user, so a
    // stranger can guess one. `canceled` is terminal — the status poll never
    // revives it — so honouring an unproven cancel let an attacker strand a
    // payment: the victim paid, their own callback never landed, and the poll
    // refused to heal the row. Money moved, nothing granted.
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      authority: string;
      paymentId: string;
    };

    // No auth, no orderId, no Authority — just the guessed authority.
    const attack = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?authority=${body.authority}`,
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
    h.psp._settle(body.authority, "paid");
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
    // authority matched a real row, so the 500 was itself an existence oracle.
    const { access } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      authority: string;
      paymentId: string;
    };

    const dup = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${body.paymentId}&paymentId=${crypto.randomUUID()}&Authority=${body.authority}&Status=OK`,
    });
    expect(dup.statusCode).toBe(200);

    const [p] = await h.query<{ status: string }>(
      `select status from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("redirected"); // proved nothing, so nothing was written
  });

  it("gives a real and a nonexistent authority the identical unproven answer", async () => {
    // Otherwise the callback is an existence oracle: walking sequential authoritys
    // and diffing the page tells a stranger which ones are real payments, i.e. a
    // live read on sales volume.
    const { access } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as { authority: string };

    const real = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?authority=${body.authority}`,
    });
    const miss = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?authority=987654321`,
    });

    expect(real.statusCode).toBe(miss.statusCode);
    expect(real.body).toBe(miss.body);
  });

  it("does not disclose a stranger's paid payment to a guessed authority", async () => {
    // The result page prints the bank tracking code (`refNumber`) on a paid
    // outcome, and the callback is public. Naming a authority must not be enough
    // to read someone else's payment back.
    const { access } = await signIn();
    const body = (await checkout(access, { planId: "m1" })).json() as {
      authority: string;
      paymentId: string;
    };
    await settleAndCallback(body.authority, "paid"); // genuine callback, carries orderId

    const [paid] = await h.query<{ ref_number: string }>(
      `select ref_number from payments where id = '${body.paymentId}'`,
    );

    const snoop = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?Authority=${body.authority}&Status=OK`,
    });
    expect(snoop.body).not.toContain(paid!.ref_number);
    expect(snoop.body).not.toContain(body.paymentId);
  });

  it("refuses to grant when the verified amount differs from what we charged", async () => {
    const { access, user } = await signIn();
    const body = (await checkout(access, { planId: "m12" })).json() as {
      authority: string;
      paymentId: string;
    };

    // Tamper: the gateway "saw" a different amount than our payment row.
    h.psp._txns.get(body.authority)!.amountRial = 1_000_000;
    const cb = await settleAndCallback(body.authority, "paid");
    expect(cb.statusCode).toBe(200);
    expect(cb.body).not.toContain("پرداخت موفق");

    const [p] = await h.query<{ status: string; applied_at: string | null }>(
      `select status, applied_at from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("failed");
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

  it("does not impose a fixed hourly business cap on legitimate checkouts", async () => {
    const { access } = await signIn();
    for (let i = 0; i < 11; i++) {
      const response = await checkout(access, { planId: "m1" });
      expect(response.statusCode).toBe(200);
      const { paymentId } = response.json() as { paymentId: string };
      await h.raw(`update payments set status = 'failed' where id = '${paymentId}'`);
    }
  });

  it("keeps one requesting row when PSP capacity is busy and survives a client reload", async () => {
    const { access } = await signIn();
    const attemptId = crypto.randomUUID();
    await h.raw(`
      insert into provider_capacity_leases (kind, lease_id, expires_at)
      select 'psp', gen_random_uuid(), now() + interval '1 minute'
        from generate_series(1, 64)
    `);
    const request = h.psp.request.bind(h.psp);
    let requestCalls = 0;
    h.psp.request = async (input) => {
      requestCalls += 1;
      return request(input);
    };

    const busy = await checkout(access, { planId: "m1", attemptId });
    expect(busy.statusCode).toBe(503);
    expect(busy.headers["retry-after"]).toBeTruthy();
    const busyBody = busy.json() as {
      error: string;
      retryAfter: number;
      paymentId: string;
    };
    expect(busyBody).toMatchObject({ error: "provider_busy", paymentId: expect.any(String) });
    expect(busyBody.retryAfter).toBeGreaterThan(0);
    expect(requestCalls).toBe(0);
    expect(
      await h.query(
        `select id from payments where user_id is not null and attempt_id = '${attemptId}'`,
      ),
    ).toHaveLength(1);

    await h.raw(`delete from provider_capacity_leases where kind = 'psp'`);
    const changed = await checkout(access, { planId: "m3", attemptId });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ error: "duplicate_payment_attempt" });
    expect(requestCalls).toBe(0);

    const resumed = await checkout(access, { planId: "m1", attemptId: crypto.randomUUID() });
    expect(resumed.statusCode).toBe(200);
    expect((resumed.json() as { paymentId: string }).paymentId).toBe(busyBody.paymentId);
    expect(requestCalls).toBe(1);
    expect(
      await h.query(`select id from payments where id = '${busyBody.paymentId}'`),
    ).toHaveLength(1);
  });
});

describe("discount redemption", () => {
  it("burns the code only after a successful payment, once per user", async () => {
    await h.raw(`insert into discounts (code, percent, max_uses) values ('OFF20', 20, 10)`);
    const { access, user } = await signIn();

    const body = (await checkout(access, { planId: "m3", code: "OFF20" })).json() as {
      authority: string;
      paymentId: string;
      amountToman: number;
    };
    expect(body.amountToman).toBe(119200); // server-computed, discounted

    // Not redeemed yet — an abandoned checkout must not burn a use.
    expect(await h.query(`select * from redemptions where user_id = '${user.id}'`)).toHaveLength(0);

    await settleAndCallback(body.authority, "paid");

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

    const [p] = await h.query<{ status: string; amount_toman: number; authority: string | null }>(
      `select status, amount_toman, authority from payments where user_id = '${user.id}'`,
    );
    expect(p!.status).toBe("paid");
    expect(p!.amount_toman).toBe(0);
    expect(p!.authority).toBeNull(); // never went near the PSP
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
      authority: string;
      paymentId: string;
    };

    // Break the redemptions FK so redeemDiscount throws, without touching the
    // grant path at all.
    await h.raw(`delete from discounts where code = 'HALF'`);

    await settleAndCallback(body.authority, "paid");

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
      authority: string;
      paymentId: string;
    };

    // User paid, then the callback never reached us (closed tab, network).
    h.psp._settle(body.authority, "paid");

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
      authority: string;
      paymentId: string;
    };
    h.psp._settle(body.authority, "paid");
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
        authority: string;
        paymentId: string;
      };
      h.psp._settle(body.authority, "paid"); // gateway WOULD say paid if asked
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
