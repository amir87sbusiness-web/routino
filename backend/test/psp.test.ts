/**
 * Gateway router + ZarinPal adapter, in isolation (no DB, no network).
 *
 * The money-path integration is covered end-to-end in payments.test.ts against
 * the fake gateway. Here we prove the two NEW pieces on their own: the router's
 * fastest-healthy selection and failover, and that the ZarinPal adapter
 * translates its dialect into the canonical Zibal-coded contract the payment
 * route relies on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PspName, PspProvider, PspRequestInput } from "../src/providers/psp/index.js";
import { ZIBAL_RESULT, ZIBAL_STATUS } from "../src/providers/psp/index.js";
import { createRouter } from "../src/providers/psp/router.js";
import { zarinpalPsp } from "../src/providers/psp/zarinpal.js";

const INPUT: PspRequestInput = {
  amountRial: 1_490_000,
  callbackUrl: "https://api.routino.me/v1/payments/callback",
  orderId: "order-1",
};

/** A provider whose latency and outcome the test controls. `latency` advances
 * the shared clock during request(), so the router measures it as real time. */
function stub(
  name: PspName,
  clock: { t: number },
  opts: { latency?: number; ok?: boolean; throws?: boolean } = {},
): PspProvider & { calls: number } {
  return {
    name,
    calls: 0,
    async request() {
      this.calls++;
      clock.t += opts.latency ?? 1;
      if (opts.throws) throw new Error(`${name} down`);
      return opts.ok === false
        ? { ok: false, result: -1, message: "rejected" }
        : { ok: true, ref: `${name}-ref`, result: ZIBAL_RESULT.OK };
    },
    async verify(ref: string) {
      return {
        result: ZIBAL_RESULT.OK,
        status: ZIBAL_STATUS.PAID_VERIFIED,
        amount: 0,
        refNumber: `${name}:${ref}`,
      };
    },
    startUrl(ref: string) {
      return `https://${name}/start/${ref}`;
    },
  };
}

describe("psp router", () => {
  it("with a single gateway, always uses it (‘one is enough’)", async () => {
    const clock = { t: 1000 };
    const r = createRouter([stub("zibal", clock, { latency: 5 })], () => clock.t);
    expect(r.providers).toEqual(["zibal"]);
    const res = await r.request(INPUT);
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("zibal");
    expect(res.ref).toBe("zibal-ref");
  });

  it("fails over to the next gateway when the first throws", async () => {
    const clock = { t: 1000 };
    const first = stub("zarinpal", clock, { throws: true });
    const second = stub("zibal", clock, { latency: 5 });
    const r = createRouter([first, second], () => clock.t);
    const res = await r.request(INPUT);
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("zibal");
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(1);
  });

  it("fails over when the first gateway hard-rejects (ok:false)", async () => {
    const clock = { t: 1000 };
    const r = createRouter(
      [stub("zarinpal", clock, { ok: false }), stub("zibal", clock, { latency: 5 })],
      () => clock.t,
    );
    const res = await r.request(INPUT);
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("zibal");
  });

  it("returns the last failure when every gateway is down", async () => {
    const clock = { t: 1000 };
    const r = createRouter(
      [stub("zarinpal", clock, { throws: true }), stub("zibal", clock, { throws: true })],
      () => clock.t,
    );
    const res = await r.request(INPUT);
    expect(res.ok).toBe(false);
  });

  it("converges on the fastest gateway once latencies are known", async () => {
    const clock = { t: 1000 };
    // Config order puts the slow one first; the router must still settle on fast.
    const r = createRouter(
      [stub("zarinpal", clock, { latency: 80 }), stub("zibal", clock, { latency: 4 })],
      () => clock.t,
    );
    await r.request(INPUT); // samples the first (slow) one
    await r.request(INPUT); // now the untried fast one wins and is sampled
    const third = await r.request(INPUT);
    expect(third.provider).toBe("zibal"); // fastest by measured latency
  });

  it("routes verify and startUrl to the named provider, not the fastest", async () => {
    const clock = { t: 1000 };
    const r = createRouter(
      [stub("zarinpal", clock, { latency: 4 }), stub("zibal", clock, { latency: 80 })],
      () => clock.t,
    );
    expect(r.startUrl("zibal", "42")).toBe("https://zibal/start/42");
    const v = await r.verify("zibal", "42", 1000);
    expect(v.refNumber).toBe("zibal:42");
  });
});

describe("zarinpal adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stubs global fetch and records the last JSON body sent. */
  function mockFetch(response: unknown, capture?: { body?: unknown; url?: string }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        if (capture) {
          capture.url = url;
          capture.body = JSON.parse(init.body);
        }
        return { ok: true, json: async () => response } as Response;
      }),
    );
  }

  it("requests in Rial with an explicit IRR currency and returns the authority as ref", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    mockFetch(
      { data: { code: 100, authority: "A00000000000000000000000000abcdef123" }, errors: [] },
      cap,
    );
    const res = await zarinpalPsp("merchant-x").request(INPUT);

    expect(res.ok).toBe(true);
    expect(res.result).toBe(ZIBAL_RESULT.OK);
    expect(res.ref).toBe("A00000000000000000000000000abcdef123");
    expect(cap.body).toMatchObject({
      amount: INPUT.amountRial, // Rial, not Toman
      currency: "IRR",
      merchant_id: "merchant-x",
    });
  });

  it("treats a non-100 request code as a failure", async () => {
    mockFetch({ data: [], errors: { code: -9, message: "validation" } });
    const res = await zarinpalPsp("m").request(INPUT);
    expect(res.ok).toBe(false);
  });

  it("maps a verified payment to the canonical paid-and-verified codes", async () => {
    const cap: { body?: Record<string, unknown> } = {};
    mockFetch(
      { data: { code: 100, ref_id: 998877, card_pan: "603799******1234" }, errors: [] },
      cap,
    );
    const v = await zarinpalPsp("m").verify("A000", 1_490_000);

    expect(v.result).toBe(ZIBAL_RESULT.OK);
    expect(v.status).toBe(ZIBAL_STATUS.PAID_VERIFIED);
    // ZarinPal's verify carries no amount; the adapter echoes the amount we sent
    // so the payment route's `amount === charged` assertion stays honest.
    expect(v.amount).toBe(1_490_000);
    expect(cap.body).toMatchObject({ amount: 1_490_000 });
    expect(v.refNumber).toBe("998877");
    expect(v.cardNumber).toBe("603799******1234");
  });

  it("maps ‘already verified’ (101) to the idempotent ALREADY_VERIFIED code", async () => {
    mockFetch({ data: { code: 101, ref_id: 1 }, errors: [] });
    const v = await zarinpalPsp("m").verify("A000", 1000);
    expect(v.result).toBe(ZIBAL_RESULT.ALREADY_VERIFIED);
  });

  it("does not report success on a verify mismatch/failure code", async () => {
    mockFetch({ data: [], errors: { code: -55, message: "amount mismatch" } });
    const v = await zarinpalPsp("m").verify("A000", 1000);
    expect(v.result).not.toBe(ZIBAL_RESULT.OK);
    expect(v.result).not.toBe(ZIBAL_RESULT.ALREADY_VERIFIED);
    expect(v.status).not.toBe(ZIBAL_STATUS.PAID_VERIFIED);
  });

  it("builds the StartPay URL from the authority", () => {
    expect(zarinpalPsp("m").startUrl("A000")).toBe("https://payment.zarinpal.com/pg/StartPay/A000");
  });
});
