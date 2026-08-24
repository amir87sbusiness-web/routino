import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ZIBAL_RESULT,
  ZIBAL_STATUS,
  type PspProvider,
  type PspVerifyResult,
} from "../functions/api/shared/providers/psp/index.ts";
import { auth, makeHarness, signIn, type Harness } from "./helpers/harness.ts";

const TRANS_ID = "36f0c4fe-79d5-4e89-b950-bd24b66a2b7a";

function nextpayMock(): PspProvider & {
  verifyCalls: number;
  orderId?: string;
  answers: PspVerifyResult[];
} {
  return {
    name: "nextpay",
    verifyCalls: 0,
    answers: [],
    async request(input) {
      this.orderId = input.orderId;
      return {
        ok: true,
        ref: TRANS_ID,
        result: ZIBAL_RESULT.OK,
        providerCode: -1,
      };
    },
    async verify() {
      this.verifyCalls += 1;
      return (
        this.answers.shift() ?? {
          result: ZIBAL_RESULT.OK,
          providerCode: 0,
          status: ZIBAL_STATUS.PAID_VERIFIED,
          amount: 590_000,
          orderId: this.orderId,
          refNumber: "EDGE-SHAPARAK-1",
        }
      );
    },
    startUrl(ref) {
      return `https://nextpay.org/nx/gateway/payment/${ref}`;
    },
  };
}

describe("Edge mocked NextPay flow", () => {
  let h: Harness;
  let provider: ReturnType<typeof nextpayMock>;

  beforeEach(async () => {
    provider = nextpayMock();
    h = await makeHarness({}, provider);
  });

  afterEach(async () => {
    await h?.close();
  });

  it("persists trans_id before redirect and grants once after authoritative Verify", async () => {
    const { access, user } = await signIn(h);
    const checkout = await h.call("POST", "/v1/payments/checkout", {
      headers: auth(access),
      body: { planId: "m1", attemptId: crypto.randomUUID() },
    });
    const body = await checkout.json();

    expect(checkout.status).toBe(200);
    expect(body.paymentUrl).toBe(`https://nextpay.org/nx/gateway/payment/${TRANS_ID}`);
    const [storedBeforeRedirect] = await h.query<{
      provider: string;
      provider_ref: string;
      status: string;
    }>(`select provider, provider_ref, status from payments where id = '${body.paymentId}'`);
    expect(storedBeforeRedirect).toEqual({
      provider: "nextpay",
      provider_ref: TRANS_ID,
      status: "redirected",
    });

    const callbackUrl =
      `/v1/payments/callback?trans_id=${TRANS_ID}&order_id=${body.paymentId}` + `&amount=999999999`;
    expect(await (await h.call("GET", callbackUrl)).text()).toContain("پرداخت موفق");
    expect(await (await h.call("GET", callbackUrl)).text()).toContain("پرداخت موفق");
    expect(provider.verifyCalls).toBe(1);
    expect(
      await h.query(
        `select id from grants where user_id = '${user.id}' and payment_id = '${body.paymentId}'`,
      ),
    ).toHaveLength(1);
  });

  it("keeps a transient Verify result retryable on Edge", async () => {
    provider.answers.push({
      result: -42,
      providerCode: -42,
      failureKind: "transient_verify",
    });
    const { access } = await signIn(h);
    const checkout = await h.call("POST", "/v1/payments/checkout", {
      headers: auth(access),
      body: { planId: "m1", attemptId: crypto.randomUUID() },
    });
    const body = await checkout.json();
    const callbackUrl = `/v1/payments/callback?trans_id=${TRANS_ID}&order_id=${body.paymentId}`;

    expect(await (await h.call("GET", callbackUrl)).text()).toContain("در حال بررسی");
    const [retryable] = await h.query<{ status: string }>(
      `select status from payments where id = '${body.paymentId}'`,
    );
    expect(retryable?.status).toBe("redirected");
    expect(await (await h.call("GET", callbackUrl)).text()).toContain("پرداخت موفق");
  });
});
