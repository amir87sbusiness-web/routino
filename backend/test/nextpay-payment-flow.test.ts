import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "../src/db/schema.js";
import {
  PspTransportError,
  ZIBAL_RESULT,
  ZIBAL_STATUS,
  type PspProvider,
  type PspVerifyResult,
} from "../src/providers/psp/index.js";
import { createRouter } from "../src/providers/psp/router.js";
import { handlePaymentCallback, settleOne, type PaymentRow } from "../src/services/payment-flow.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

const TRANS_ID = "36f0c4fe-79d5-4e89-b950-bd24b66a2b7a";
const NOW = new Date("2026-08-24T10:00:00.000Z");

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

async function fixture(
  overrides: Partial<typeof schema.payments.$inferInsert> = {},
): Promise<PaymentRow> {
  const [user] = await h.db
    .insert(schema.users)
    .values({ phone: `98912${String(Math.random()).slice(2, 9)}` })
    .returning();
  if (!user) throw new Error("user fixture failed");
  const [payment] = await h.db
    .insert(schema.payments)
    .values({
      userId: user.id,
      attemptId: crypto.randomUUID(),
      planId: "m1",
      months: 1,
      amountToman: 59_000,
      amountRial: 590_000,
      status: "redirected",
      platform: "web",
      provider: "nextpay",
      providerRef: TRANS_ID,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    })
    .returning();
  if (!payment) throw new Error("payment fixture failed");
  return payment;
}

function nextpayStub(
  verifyImpl: () => Promise<PspVerifyResult> | PspVerifyResult,
): PspProvider & { verifyCalls: number } {
  return {
    name: "nextpay",
    verifyCalls: 0,
    async request() {
      return { ok: true, result: ZIBAL_RESULT.OK, ref: TRANS_ID };
    },
    async verify() {
      this.verifyCalls += 1;
      return verifyImpl();
    },
    startUrl(ref) {
      return `https://nextpay.org/nx/gateway/payment/${ref}`;
    },
  };
}

const paid = (orderId: string): PspVerifyResult => ({
  result: ZIBAL_RESULT.OK,
  providerCode: 0,
  status: ZIBAL_STATUS.PAID_VERIFIED,
  amount: 590_000,
  orderId,
  refNumber: "SHAPARAK-1",
});

async function callback(payment: PaymentRow, provider: PspProvider, extra = {}) {
  return handlePaymentCallback(
    h.db,
    createRouter([provider]),
    {
      trans_id: payment.providerRef,
      order_id: payment.id,
      amount: "1",
      ...extra,
    },
    NOW,
  );
}

async function grantCount(paymentId: string): Promise<number> {
  const rows = await h.db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.paymentId, paymentId));
  return rows.length;
}

describe("NextPay callback and Verify state machine", () => {
  it("ignores callback amount and grants only after matching backend Verify", async () => {
    const payment = await fixture();
    const provider = nextpayStub(() => paid(payment.id));

    const result = await callback(payment, provider, { amount: "999999999" });

    expect(result.outcome).toBe("paid");
    expect(provider.verifyCalls).toBe(1);
    expect(await grantCount(payment.id)).toBe(1);
    const [stored] = await h.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));
    expect(stored?.pspResult).toBe(0);
  });

  it("keeps an altered callback order_id neutral and performs no Verify", async () => {
    const payment = await fixture();
    const provider = nextpayStub(() => paid(payment.id));

    const result = await callback(payment, provider, { order_id: crypto.randomUUID() });

    expect(result).toEqual({ outcome: "pending" });
    expect(provider.verifyCalls).toBe(0);
    expect(await grantCount(payment.id)).toBe(0);
  });

  it("rejects a provider-verified order_id mismatch", async () => {
    const payment = await fixture();
    const provider = nextpayStub(() => paid(crypto.randomUUID()));

    const result = await callback(payment, provider);
    const [fresh] = await h.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));

    expect(result.outcome).toBe("verify_failed");
    expect(fresh?.status).toBe("verify_failed");
    expect(await grantCount(payment.id)).toBe(0);
  });

  it("rejects a provider-verified amount mismatch", async () => {
    const payment = await fixture();
    const provider = nextpayStub(() => ({ ...paid(payment.id), amount: 10 }));

    expect((await callback(payment, provider)).outcome).toBe("verify_failed");
    expect(await grantCount(payment.id)).toBe(0);
  });

  it("looks up trans_id with provider scope", async () => {
    const other = await fixture({ provider: "zibal" });
    const provider = nextpayStub(() => paid(other.id));

    const result = await callback(other, provider);

    expect(result).toEqual({ outcome: "pending" });
    expect(provider.verifyCalls).toBe(0);
  });

  it("serializes duplicate callbacks so Verify and grant happen once", async () => {
    const payment = await fixture();
    let release!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = nextpayStub(async () => {
      started();
      await gate;
      return paid(payment.id);
    });

    const first = callback(payment, provider);
    await began;
    const second = callback(payment, provider);
    release();
    const outcomes = await Promise.all([first, second]);

    expect(provider.verifyCalls).toBe(1);
    expect(outcomes.some((result) => result.outcome === "paid")).toBe(true);
    expect(await grantCount(payment.id)).toBe(1);
  });

  it("restores a transient Verify result for a later successful retry", async () => {
    const payment = await fixture();
    const answers: PspVerifyResult[] = [
      { result: -42, providerCode: -42, failureKind: "transient_verify" },
      paid(payment.id),
    ];
    const provider = nextpayStub(() => answers.shift()!);

    expect((await callback(payment, provider)).outcome).toBe("pending");
    const [afterTransient] = await h.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));
    expect(afterTransient?.status).toBe("redirected");
    expect(afterTransient?.appliedAt).toBeNull();

    expect((await callback(afterTransient!, provider)).outcome).toBe("paid");
    expect(await grantCount(payment.id)).toBe(1);
  });

  it("restores a timeout for a later successful retry", async () => {
    const payment = await fixture();
    let first = true;
    const provider = nextpayStub(() => {
      if (first) {
        first = false;
        throw new PspTransportError("timeout");
      }
      return paid(payment.id);
    });

    expect((await callback(payment, provider)).outcome).toBe("pending");
    const [retryable] = await h.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));
    expect(retryable?.status).toBe("redirected");
    expect((await callback(retryable!, provider)).outcome).toBe("paid");
  });

  it("keeps an invalid provider Verify payload recoverable", async () => {
    const payment = await fixture();
    const answers: PspVerifyResult[] = [
      { result: 0, failureKind: "invalid_response" },
      paid(payment.id),
    ];
    const provider = nextpayStub(() => answers.shift()!);

    expect((await callback(payment, provider)).outcome).toBe("pending");
    const [retryable] = await h.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));
    expect(retryable?.status).toBe("redirected");
    expect((await callback(retryable!, provider)).outcome).toBe("paid");
  });

  it("reclaims a stale verifying lease", async () => {
    const payment = await fixture({
      status: "verifying",
      updatedAt: new Date(NOW.getTime() - 120_000),
    });
    const provider = nextpayStub(() => paid(payment.id));

    expect(await settleOne(h.db, createRouter([provider]), payment, NOW)).toBe(true);
    expect(provider.verifyCalls).toBe(1);
    expect(await grantCount(payment.id)).toBe(1);
  });

  it("makes an authoritative terminal failure terminal without granting", async () => {
    const payment = await fixture();
    const provider = nextpayStub(() => ({
      result: -2,
      providerCode: -2,
      failureKind: "terminal_verify",
      status: ZIBAL_STATUS.INTERNAL_ERROR,
    }));

    expect((await callback(payment, provider)).outcome).toBe("failed");
    const [fresh] = await h.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));
    expect(fresh?.status).toBe("failed");
    expect(fresh?.pspResult).toBe(-2);
    expect(await grantCount(payment.id)).toBe(0);
  });

  it("does not call NextPay again after local success", async () => {
    const payment = await fixture();
    const firstProvider = nextpayStub(() => paid(payment.id));
    expect((await callback(payment, firstProvider)).outcome).toBe("paid");

    const [applied] = await h.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));
    const replayProvider = nextpayStub(() => {
      throw new Error("must not verify again");
    });
    expect((await callback(applied!, replayProvider)).outcome).toBe("paid");
    expect(replayProvider.verifyCalls).toBe(0);
    expect(await grantCount(payment.id)).toBe(1);
  });
});
