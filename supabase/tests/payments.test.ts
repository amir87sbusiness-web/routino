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
  return h.call("POST", "/v1/payments/checkout", { headers: auth(access), body });
}

/** Clicks "Pay"/"Cancel" on the fake gateway and follows the redirect into the
 * callback, exactly as a browser would. Returns the callback response. */
async function settleAndCallback(trackId: number, outcome: "paid" | "canceled") {
  const settle = await h.call(
    "GET",
    `/v1/dev/gateway/settle?trackId=${trackId}&outcome=${outcome}`,
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
  it("completes a payment and grants the plan exactly once", async () => {
    const { access, user, entitlement } = await signIn(h);
    const res = await checkout(access, { planId: "m3", platform: "web" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      free: boolean;
      paymentId: string;
      trackId: number;
      paymentUrl: string;
    };
    expect(body.free).toBe(false);
    expect(body.paymentUrl).toContain("/v1/dev/gateway?trackId=");

    const cb = await settleAndCallback(body.trackId, "paid");
    expect(cb.status).toBe(200);
    // Result page must be marked HTML so the Worker renders it (not raw text).
    expect(cb.headers.get("x-routino-html")).toBe("1");
    expect(await cb.text()).toContain("پرداخت موفق");

    const [p] = await h.query<{
      status: string;
      applied_at: string | null;
      ref_number: string;
      provider: string;
    }>(
      `select status, applied_at, ref_number, provider from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("paid");
    expect(p!.applied_at).not.toBeNull();
    expect(p!.ref_number).toContain("FAKE-");
    expect(p!.provider).toBe("fake");

    // 3 calendar months stacked on the trial's remaining days, not replacing them.
    const status = await h.call("GET", `/v1/payments/${body.paymentId}`, { headers: auth(access) });
    const after = Date.parse((await status.json()).entitlement.expiresAt);
    const trialEnd = Date.parse(entitlement.expiresAt);
    expect(after).toBeGreaterThan(trialEnd + 85 * DAY);

    const grants = await h.query<{ source: string }>(
      `select source from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("is idempotent: a replayed callback cannot double-grant", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      trackId: number;
      paymentId: string;
    };

    const first = await settleAndCallback(body.trackId, "paid");
    expect(await first.text()).toContain("پرداخت موفق");
    // Replay the exact same callback (user refreshes the page / gateway retries).
    const second = await h.call(
      "GET",
      `/v1/payments/callback?trackId=${body.trackId}&success=1&status=2&orderId=${body.paymentId}`,
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
      trackId: number;
      paymentId: string;
    };

    // Forged callback before the user actually paid at the gateway.
    const forged = await h.call(
      "GET",
      `/v1/payments/callback?trackId=${body.trackId}&success=1&status=2&orderId=${body.paymentId}`,
    );
    expect(await forged.text()).toContain("در حال بررسی"); // pending page, no grant

    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(0);

    // And the REAL payment still works afterwards — the forgery didn't poison it.
    const real = await settleAndCallback(body.trackId, "paid");
    expect(await real.text()).toContain("پرداخت موفق");
  });

  it("cancel at the gateway marks the payment canceled and grants nothing", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      trackId: number;
      paymentId: string;
    };

    const cb = await settleAndCallback(body.trackId, "canceled");
    expect(await cb.text()).toContain("لغو");

    const [p] = await h.query<{ status: string }>(
      `select status from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("canceled");
    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(0);
  });

  it("refuses to grant when the verified amount differs from what we charged", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m12" })).json()) as {
      trackId: number;
      paymentId: string;
    };

    // Tamper: the gateway "saw" a different amount than our payment row.
    h.psp._txns.get(body.trackId)!.amountRial = 1_000_000;
    const cb = await settleAndCallback(body.trackId, "paid");
    expect(cb.status).toBe(200);
    expect(await cb.text()).not.toContain("پرداخت موفق");

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
    const { access } = await signIn(h);
    expect((await checkout(access, { planId: "m99" })).status).toBe(404);
  });

  it("rate-limits checkout creation", async () => {
    const { access } = await signIn(h);
    for (let i = 0; i < 10; i++) {
      expect((await checkout(access, { planId: "m1" })).status).toBe(200);
    }
    const blocked = await checkout(access, { planId: "m1" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
  });
});

describe("discount redemption", () => {
  it("burns the code only after a successful payment, once per user", async () => {
    await h.raw(`insert into discounts (code, percent, max_uses) values ('OFF20', 20, 10)`);
    const { access, user } = await signIn(h);

    const body = (await (await checkout(access, { planId: "m3", code: "OFF20" })).json()) as {
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
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      trackId: number;
      paymentId: string;
    };

    // User paid, then the callback never reached us (closed tab, network).
    h.psp._settle(body.trackId, "paid");

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
  it("ignores a cancel claim from someone who only guessed the trackId", async () => {
    const { access, user } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as {
      trackId: number;
      paymentId: string;
    };

    const attack = await h.call("GET", `/v1/payments/callback?trackId=${body.trackId}`);
    expect(attack.status).toBe(200);
    expect(await attack.clone().text()).not.toContain(body.paymentId);

    const [p] = await h.query<{ status: string }>(
      `select status from payments where id = '${body.paymentId}'`,
    );
    expect(p!.status).toBe("redirected"); // untouched — nothing was proven

    // The victim really paid but their browser never came back: the poll must
    // still heal it.
    h.psp._settle(body.trackId, "paid");
    const poll = await h.call("GET", `/v1/payments/${body.paymentId}`, { headers: auth(access) });
    expect((await poll.json()).payment.status).toBe("paid");

    const grants = await h.query(
      `select id from grants where user_id = '${user.id}' and source = 'payment'`,
    );
    expect(grants).toHaveLength(1);
  });

  it("gives a real and a nonexistent trackId the identical unproven answer", async () => {
    const { access } = await signIn(h);
    const body = (await (await checkout(access, { planId: "m1" })).json()) as { trackId: number };

    const real = await h.call("GET", `/v1/payments/callback?trackId=${body.trackId}`);
    const miss = await h.call("GET", `/v1/payments/callback?trackId=987654321`);

    expect(real.status).toBe(miss.status);
    expect(await real.text()).toBe(await miss.text());
  });
});
