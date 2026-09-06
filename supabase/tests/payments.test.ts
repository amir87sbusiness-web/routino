/**
 * The money path, end to end against the DEPLOYED app: the same Hono app +
 * shared payment-flow service the edge function ships. Mirrors
 * backend/test/payments.test.ts — every invariant asserted there must hold
 * here, or the port is wrong.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth, makeHarness, signIn, type Harness } from "./helpers/harness.ts";

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

async function checkout(access: string, body: Record<string, unknown>) {
  return h.call("POST", "/v1/payments/checkout", {
    headers: auth(access),
    body: { attemptId: crypto.randomUUID(), ...body },
  });
}

async function startTrial(access: string) {
  const res = await h.call("POST", "/v1/subscriptions/trial/start", {
    headers: auth(access),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { entitlement: { expiresAt: string } };
}

/** Clicks "Pay"/"Cancel" on the fake gateway and follows the redirect into the
 * callback, exactly as a browser would. Returns the callback response. */
async function settleAndCallback(authority: string, outcome: "paid" | "canceled") {
  const settle = await h.call(
    "GET",
    `/v1/dev/gateway/settle?Authority=${authority}&outcome=${outcome}`,
  );
  expect(settle.status).toBe(302);
  const location = settle.headers.get("location")!;
  return h.follow(location);
}

describe("POST /v1/payments/quote", () => {
  it("requires auth", async () => {
    const res = await h.call("POST", "/v1/payments/quote", { body: { planId: "m1" } });
    expect(res.status).toBe(401);
  });

  it("prices from the database and validates codes server-side", async () => {
    await h.raw(`insert into discounts (code, percent) values ('OFF20', 20)`);
    const { access } = await signIn(h);

    const plain = await h.call("POST", "/v1/payments/quote", {
      headers: auth(access),
      body: { planId: "m3" },
    });
    expect((await plain.json()).quote.finalToman).toBe(149000);

    const coded = await h.call("POST", "/v1/payments/quote", {
      headers: auth(access),
      body: { planId: "m3", code: "off20" },
    });
    const codedBody = await coded.json();
    expect(codedBody.quote.finalToman).toBe(119200);
    expect(codedBody.discount.valid).toBe(true);

    const bad = await h.call("POST", "/v1/payments/quote", {
      headers: auth(access),
      body: { planId: "m3", code: "NOPE" },
    });
    const badBody = await bad.json();
    expect(badBody.quote.finalToman).toBe(149000);
    expect(badBody.discount.reason).toBe("unknown");
  });
});

describe("checkout → gateway → callback", () => {
  it("requires a checkout attempt UUID on Edge", async () => {
    const { access } = await signIn(h);
    const res = await h.call("POST", "/v1/payments/checkout", {
      headers: auth(access),
      body: { planId: "m1" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("reuses one Edge checkout for a repeated attempt UUID", async () => {
    const { access, user } = await signIn(h);
    const attemptId = crypto.randomUUID();
    const first = await checkout(access, { planId: "m1", attemptId });
    const second = await checkout(access, { planId: "m1", attemptId });
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody.paymentId).toBe(firstBody.paymentId);
    expect(h.psp._txns.size).toBe(1);
    expect(await h.query(`select id from payments where user_id = '${user.id}'`)).toHaveLength(1);
  });

  it("completes a payment and grants the plan exactly once", async () => {
    const { access, user } = await signIn(h);
    const trial = await startTrial(access);
    const res = await checkout(access, { planId: "m3", platform: "web" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      free: boolean;
      paymentId: string;
      authority: string;
      paymentUrl: string;
    };
    expect(body.free).toBe(false);
    expect(body.paymentUrl).toContain("/v1/dev/gateway?Authority=");

    const cb = await settleAndCallback(body.authority, "paid");
    expect(cb.status).toBe(200);
    // Result page must be marked HTML so the Worker renders it (not raw text).
    expect(cb.headers.get("x-routino-html")).toBe("1");
    expect(await cb.text()).toContain("پرداخت موفق");

    const [p] = await h.query<{
      status: string;
      applied_at: string | null;
      ref_number: string;
    }>(`select status, applied_at, ref_number from payments where id = '${body.paymentId}'`);
    expect(p!.status).toBe("paid");
    expect(p!.applied_at).not.toBeNull();
    expect(p!.ref_number).toContain("FAKE-");

    // 3 calendar months stacked on the trial's remaining days, not replacing them.
    const status = await h.call("GET", `/v1/payments/${body.paymentId}`, { headers: auth(access) });
    const after = Date.parse((await status.json()).entitlement.expiresAt);
    const trialEnd = Date.parse(trial.entitlement.expiresAt);
    expect(after).toBeGreaterThan(trialEnd + 85 * DAY);

    const grants = await h.query<{ source: string }>(
      `select source from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("is idempotent: a replayed callback cannot double-grant", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      authority: string;
      paymentId: string;
    };

    const first = await settleAndCallback(body.authority, "paid");
    expect(await first.text()).toContain("پرداخت موفق");
    // Replay the exact same callback (user refreshes the page / gateway retries).
    const second = await h.call(
      "GET",
      `/v1/payments/callback?paymentId=${body.paymentId}&Authority=${body.authority}&Status=OK`,
    );
    expect(await second.text()).toContain("پرداخت موفق");

    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("never trusts success=1 from the URL: unsettled payment stays ungranted", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      authority: string;
      paymentId: string;
    };

    // Forged callback before the user actually paid at the gateway.
    const forged = await h.call(
      "GET",
      `/v1/payments/callback?paymentId=${body.paymentId}&Authority=${body.authority}&Status=OK`,
    );
    expect(await forged.text()).toContain("در حال بررسی"); // pending page, no grant

    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(0);

    // And the REAL payment still works afterwards — the forgery didn't poison it.
    const pending = await settleAndCallback(body.authority, "paid");
    expect(await pending.text()).toContain("در حال بررسی");
    await h.raw(
      `update payments set next_verify_at = now() - interval '1 second' where id = '${body.paymentId}'`,
    );
    const real = await settleAndCallback(body.authority, "paid");
    expect(await real.text()).toContain("پرداخت موفق");
  });

  it("renders cancellation without making a recoverable payment terminal", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      authority: string;
      paymentId: string;
    };

    const cb = await settleAndCallback(body.authority, "canceled");
    expect(await cb.text()).toContain("لغو");

    const [p] = await h.query<{ status: string }>(
      `select status from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("redirected");
    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(0);
  });

  it("refuses to grant when the verified amount differs from what we charged", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m12" })).json()) as {
      authority: string;
      paymentId: string;
    };

    // Tamper: the gateway "saw" a different amount than our payment row.
    h.psp._txns.get(body.authority)!.amountRial = 1_000_000;
    const cb = await settleAndCallback(body.authority, "paid");
    expect(cb.status).toBe(200);
    expect(await cb.text()).not.toContain("پرداخت موفق");

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
    const { access } = await signIn(h);
    expect((await checkout(access, { planId: "m99" })).status).toBe(404);
  });

  it("does not impose a fixed hourly business cap on legitimate checkouts", async () => {
    const { access } = await signIn(h);
    for (let i = 0; i < 11; i++) {
      const response = await checkout(access, { planId: "m1" });
      expect(response.status).toBe(200);
      const { paymentId } = (await response.json()) as { paymentId: string };
      await h.raw(`update payments set status = 'failed' where id = '${paymentId}'`);
    }
  });
});

describe("discount redemption", () => {
  it("burns the code only after a successful payment, once per user", async () => {
    await h.raw(`insert into discounts (code, percent, max_uses) values ('OFF20', 20, 10)`);
    const { access, user } = await signIn(h);

    const body = (await (await checkout(access, { planId: "m3", code: "OFF20" })).json()) as {
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
    const again = await h.call("POST", "/v1/payments/quote", {
      headers: auth(access),
      body: { planId: "m1", code: "OFF20" },
    });
    expect((await again.json()).discount.reason).toBe("already_used");
  });

  it("grants a 100% discount directly without touching the gateway", async () => {
    await h.raw(`insert into discounts (code, percent) values ('FREE100', 100)`);
    const { access, user } = await signIn(h);

    const res = await checkout(access, { planId: "m1", code: "FREE100" });
    const body = (await res.json()) as { free: boolean; entitlement: { status: string } };
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

describe("GET /v1/payments/:id", () => {
  it("self-heals a paid-but-never-called-back payment", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      authority: string;
      paymentId: string;
    };

    // User paid, then the callback never reached us (closed tab, network).
    h.psp._settle(body.authority, "paid");

    const res = await h.call("GET", `/v1/payments/${body.paymentId}`, { headers: auth(access) });
    const out = await res.json();
    expect(out.payment.status).toBe("paid");
    expect(out.entitlement.status).toBe("active");
    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("hides other users' payments", async () => {
    const { access } = await signIn(h, "09123334444");
    const body = (await (await checkout(access, { planId: "m1" })).json()) as { paymentId: string };
    const other = await signIn(h, "09351112222");
    const res = await h.call("GET", `/v1/payments/${body.paymentId}`, {
      headers: auth(other.access),
    });
    expect(res.status).toBe(404);
  });
});

describe("edge: the public callback only acts for a proven caller", () => {
  // routes/payments.ts is hand-mirrored from Fastify (only shared/ is generated),
  // and this is the branch's highest-severity fix, so it needs edge coverage of
  // its own rather than relying on the backend suite.
  it("ignores a cancel claim from someone who only guessed the authority", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      authority: string;
      paymentId: string;
    };

    const attack = await h.call("GET", `/v1/payments/callback?authority=${body.authority}`);
    expect(attack.status).toBe(200);
    expect(await attack.clone().text()).not.toContain(body.paymentId);

    const [p] = await h.query<{ status: string }>(
      `select status from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("redirected"); // untouched — nothing was proven

    // The victim really paid but their browser never came back: the poll must
    // still heal it.
    h.psp._settle(body.authority, "paid");
    const poll = await h.call("GET", `/v1/payments/${body.paymentId}`, { headers: auth(access) });
    expect((await poll.json()).payment.status).toBe("paid");

    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("rejects duplicated callback keys instead of silently choosing one", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      authority: string;
      paymentId: string;
    };
    h.psp._settle(body.authority, "paid");

    const attack = await h.call(
      "GET",
      `/v1/payments/callback?paymentId=${body.paymentId}&paymentId=${crypto.randomUUID()}&Authority=${body.authority}&Status=OK`,
    );
    expect(attack.status).toBe(200);
    const html = await attack.text();
    expect(html).toContain("در حال بررسی");
    expect(html).not.toContain(body.paymentId);
    expect(
      await h.query(`select id from grants where user_id = '${user.id}' and source = 'payment'`),
    ).toHaveLength(0);
  });

  it("gives a real and a nonexistent authority the identical unproven answer", async () => {
    const { access } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as { authority: string };

    const real = await h.call("GET", `/v1/payments/callback?authority=${body.authority}`);
    const miss = await h.call("GET", `/v1/payments/callback?authority=987654321`);

    expect(real.status).toBe(miss.status);
    expect(await real.text()).toBe(await miss.text());
  });
});
