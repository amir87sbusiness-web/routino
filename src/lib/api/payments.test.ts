import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";

const auth = vi.hoisted(() => ({ authedRequest: vi.fn() }));

vi.mock("./auth", () => auth);

import { checkout, checkoutWithProviderBusyRetry } from "./payments";

describe("payment checkout API", () => {
  beforeEach(() => {
    auth.authedRequest.mockReset().mockResolvedValue({
      free: false,
      paymentId: "payment-1",
      paymentUrl: "https://gateway.test/payment",
    });
  });

  it("sends the idempotency key but no amount, entitlement, or merchant secret", async () => {
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
    expect(serialized).not.toMatch(/amount|months|entitlement|merchant|api_key/i);
  });

  it("retries provider_busy with the same attempt id and bounded delays", async () => {
    vi.useFakeTimers();
    auth.authedRequest
      .mockRejectedValueOnce(new ApiError(503, "provider_busy", "busy", false, 1))
      .mockRejectedValueOnce(new ApiError(503, "provider_busy", "busy", false, 1))
      .mockResolvedValueOnce({ free: false, paymentId: "payment-1" });
    const attemptId = crypto.randomUUID();

    const result = checkoutWithProviderBusyRetry("m1", undefined, "web", attemptId);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ paymentId: "payment-1" });

    expect(auth.authedRequest).toHaveBeenCalledTimes(3);
    expect(auth.authedRequest.mock.calls.map((call) => call[1].body.attemptId)).toEqual([
      attemptId,
      attemptId,
      attemptId,
    ]);
    vi.useRealTimers();
  });

  it("stops provider_busy retries when the checkout screen aborts", async () => {
    vi.useFakeTimers();
    auth.authedRequest.mockRejectedValue(new ApiError(503, "provider_busy", "busy", false, 2));
    const controller = new AbortController();
    const result = checkoutWithProviderBusyRetry(
      "m1",
      undefined,
      "web",
      crypto.randomUUID(),
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();
    expect(auth.authedRequest).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
