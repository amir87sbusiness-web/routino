import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";

const auth = vi.hoisted(() => ({ authedRequest: vi.fn() }));
const client = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("./auth", () => auth);
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  apiRequest: client.apiRequest,
}));

import { checkout, checkoutWithProviderBusyRetry, fetchPlans } from "./payments";

describe("payment checkout API", () => {
  beforeEach(() => {
    localStorage.clear();
    client.apiRequest.mockReset().mockResolvedValue({
      plans: [
        {
          id: "m3",
          nameFa: "سه‌ماهه",
          nameEn: "3 Months",
          months: 3,
          price: 100_000,
          originalPrice: null,
        },
      ],
      offer: null,
    });
    auth.authedRequest.mockReset().mockResolvedValue({
      free: false,
      paymentId: "payment-1",
      paymentUrl: "https://gateway.test/payment",
    });
  });

  it("keeps a non-promotional plan response local for twelve hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T00:00:00Z"));

    await fetchPlans();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000 + 1);
    await fetchPlans();

    expect(client.apiRequest).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
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

  it("routes Android StartPay through the first-party Routino bridge", async () => {
    auth.authedRequest.mockResolvedValueOnce({
      free: false,
      paymentId: "payment-android",
      authority: "A000000000000000000000000000000001",
      paymentUrl:
        "https://payment.zarinpal.com/pg/StartPay/A000000000000000000000000000000001",
    });

    const result = await checkout("m3", undefined, "android", crypto.randomUUID());

    expect(result.paymentUrl).toBe(
      "https://routino.me/pay/start?authority=A000000000000000000000000000000001",
    );
  });

  it("does not change the normal web gateway URL", async () => {
    auth.authedRequest.mockResolvedValueOnce({
      free: false,
      paymentId: "payment-web",
      authority: "A1",
      paymentUrl: "https://payment.zarinpal.com/pg/StartPay/A1",
    });

    const result = await checkout("m3", undefined, "web", crypto.randomUUID());

    expect(result.paymentUrl).toBe("https://payment.zarinpal.com/pg/StartPay/A1");
  });

  it("fails closed on Android instead of opening StartPay directly without Authority", async () => {
    auth.authedRequest.mockResolvedValueOnce({
      free: false,
      paymentId: "payment-android-bad",
      paymentUrl: "https://payment.zarinpal.com/pg/StartPay/UNKNOWN",
    });

    const result = await checkout("m3", undefined, "android", crypto.randomUUID());

    expect(result.paymentUrl).toBeUndefined();
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

  it("turns a closed duplicate attempt into a non-retryable client error after one request", async () => {
    auth.authedRequest.mockRejectedValueOnce(
      new ApiError(409, "duplicate_payment_attempt", "closed attempt"),
    );
    const attemptId = crypto.randomUUID();

    await expect(
      checkoutWithProviderBusyRetry("m1", undefined, "android", attemptId),
    ).rejects.toMatchObject({
      status: 409,
      code: "payment_attempt_closed",
    });

    expect(auth.authedRequest).toHaveBeenCalledTimes(1);
    expect(auth.authedRequest.mock.calls[0]?.[1].body.attemptId).toBe(attemptId);
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
