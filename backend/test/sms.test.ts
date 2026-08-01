/**
 * The Kavenegar OTP provider.
 *
 * Worth its own suite because nothing else exercises it: production runs
 * `SMS_PROVIDER=console` until the template is approved, so the first time this
 * code runs for real is the day it is switched on for every user at once. A
 * wrong number format or a leaked key would show up only as a log line.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { kavenegarSms } from "../src/providers/sms/kavenegar.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Captures the URL and answers with whatever Kavenegar would. */
function stubFetch(body: unknown, ok = true, status = 200) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    return { ok, status, json: async () => body } as Response;
  }) as typeof fetch;
  return calls;
}

describe("kavenegar OTP provider", () => {
  it("sends the number in LOCAL 09… form, not the canonical 98… we store", async () => {
    // We store `989121234567`; Kavenegar's `receptor` is documented in local
    // form, and the payment path already converts before calling Zibal. Getting
    // this wrong breaks sign-up for 100% of new users the day console mode is
    // turned off.
    const calls = stubFetch({ return: { status: 200 } });
    await kavenegarSms("KEY123", "routino-otp").sendOtp("989121234567", "123456");

    const url = new URL(calls[0]!);
    expect(url.searchParams.get("receptor")).toBe("09121234567");
    expect(url.searchParams.get("token")).toBe("123456");
    expect(url.searchParams.get("template")).toBe("routino-otp");
    expect(url.pathname).toBe("/v1/KEY123/verify/lookup.json");
  });

  it("treats a non-200 Kavenegar status as a failure, not a success", async () => {
    // The HTTP request succeeds; the failure is INSIDE the body. Reading only
    // res.ok would report every rejected send as delivered.
    stubFetch({ return: { status: 411, message: "invalid receptor" } });
    await expect(
      kavenegarSms("KEY123", "routino-otp").sendOtp("989121234567", "123456"),
    ).rejects.toThrow(/411/);
  });

  it("never puts the API key or the code in an error", async () => {
    // These errors are logged, and the logs go to a third-party pipeline.
    stubFetch({}, false, 500);
    const err = await kavenegarSms("SECRETKEY", "routino-otp")
      .sendOtp("989121234567", "999888")
      .catch((e: Error) => e);

    expect(String(err)).not.toContain("SECRETKEY");
    expect(String(err)).not.toContain("999888");
  });
});
