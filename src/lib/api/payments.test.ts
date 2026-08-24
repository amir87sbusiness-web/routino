import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ authedRequest: vi.fn() }));

vi.mock("./auth", () => auth);

import { checkout } from "./payments";

describe("payment checkout API", () => {
  beforeEach(() => {
    auth.authedRequest.mockReset().mockResolvedValue({
      free: false,
      paymentId: "payment-1",
      paymentUrl: "https://gateway.test/payment",
    });
  });

  it("sends the idempotency key but no amount, entitlement, or NextPay secret", async () => {
    const attemptId = crypto.randomUUID();

    await checkout("m3", "OFF20", "web", attemptId);

    expect(auth.authedRequest).toHaveBeenCalledWith("/payments/checkout", {
      method: "POST",
      body: {
        planId: "m3",
        code: "OFF20",
        platform: "web",
        attemptId,
      },
    });
    const serialized = JSON.stringify(auth.authedRequest.mock.calls[0]);
    expect(serialized).not.toMatch(/amount|months|entitlement|NEXTPAY_API_KEY|api_key/i);
  });
});
