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
import { SmsNotSentError } from "../src/providers/sms/index.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Captures the URL and answers with whatever Kavenegar would.
 *
 * Answers `text()`, not `json()`: the provider reads the body as text once and
 * parses it itself, because Kavenegar puts its real reason (unapproved
 * template, no credit, blocked receptor) in the body even on a non-200, and a
 * stub that only offers `json()` hides that the response might not be JSON at
 * all. */
function stubFetch(body: unknown, ok = true, status = 200) {
  const calls: string[] = [];
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    return { ok, status, text: async () => raw } as Response;
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

  it("surfaces Kavenegar's own reason instead of a bare HTTP code", async () => {
    // The reason a send failed is in the BODY — "template not approved", "no
    // credit". The old code threw on !res.ok without reading it, so the one
    // piece of information that explains a launch-day outage was discarded on
    // every single failure.
    stubFetch({ return: { status: 418, message: "template not found" } }, false, 400);
    const err = await kavenegarSms("KEY123", "routino-otp")
      .sendOtp("989121234567", "123456")
      .catch((e: Error) => e);

    expect(String(err)).toContain("template not found");
  });

  it("marks a 4xx as definitely-not-sent so the rate-limit slot is refunded", async () => {
    stubFetch({ return: { status: 418, message: "invalid template" } }, false, 400);
    const err = await kavenegarSms("KEY123", "routino-otp")
      .sendOtp("989121234567", "123456")
      .catch((e: Error) => e);

    // A config error costs nothing, so the caller must be able to tell it apart
    // from an ambiguous failure and give the user their slot back.
    expect(err).toBeInstanceOf(SmsNotSentError);
  });

  it("retries once on a transient failure, then succeeds", async () => {
    // "Sometimes the SMS arrives" is what a dropped connection looks like from
    // the outside. One retry turns most of those into a delivered message
    // instead of a user staring at a spinner.
    let attempts = 0;
    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("network error");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ return: { status: 200 } }),
      } as Response;
    }) as typeof fetch;

    await kavenegarSms("KEY123", "routino-otp").sendOtp("989121234567", "123456");
    expect(attempts).toBe(2);
  });

  it("does not retry a 4xx — retrying a bad template only doubles the noise", async () => {
    let attempts = 0;
    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ return: { status: 418, message: "bad template" } }),
      } as Response;
    }) as typeof fetch;

    await kavenegarSms("KEY123", "routino-otp")
      .sendOtp("989121234567", "123456")
      .catch(() => {});
    expect(attempts).toBe(1);
  });
});
