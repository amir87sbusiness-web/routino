/**
 * When Kavenegar is down, out of credit, or rate-limiting us.
 *
 * This is the launch-day failure the owner is most likely to actually hit: an
 * advertising push drives a burst of sign-ups, and the SMS provider — not this
 * server — is the thing that buckles. What must hold is that the app degrades
 * honestly (the user is told it failed) rather than silently stranding people
 * on a screen waiting for a code that will never arrive.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

const requestCode = (phone: string) =>
  h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });

const codesFor = async (phone: string) => {
  const rows = await h.query<{ n: number }>(
    `select count(*)::int as n from otp_codes where phone = '${phone}'`,
  );
  return Number(rows[0]!.n);
};

describe("the SMS provider failing", () => {
  it("tells the user it failed instead of pretending it worked", async () => {
    const boom = vi.spyOn(h.sms, "sendOtp").mockRejectedValueOnce(new Error("kavenegar 503"));

    const res = await requestCode("09138880001");

    // 502, not 200 — the app must show "try again", not a code-entry box for a
    // code that was never sent.
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: "sms_failed" });
    boom.mockRestore();
  });

  it("never leaks the code itself when the send fails", async () => {
    const boom = vi.spyOn(h.sms, "sendOtp").mockRejectedValueOnce(new Error("kavenegar 503"));
    const res = await requestCode("09138880002");
    boom.mockRestore();

    // The failure path is the tempting place to "helpfully" return the code for
    // debugging. It must never appear in a response body.
    const rows = await h.query<{ code_hash: string }>(
      `select code_hash from otp_codes where phone = '989138880002' limit 1`,
    );
    expect(rows.length).toBe(1);
    expect(res.body).not.toContain(rows[0]!.code_hash);
    expect(res.body).not.toMatch(/\d{6}/);
  });

  it("still spends the rate-limit slot, so an outage is not a bypass", async () => {
    const phone = "09138880003";
    const boom = vi.spyOn(h.sms, "sendOtp").mockRejectedValue(new Error("kavenegar down"));

    const first = await requestCode(phone);
    expect(first.statusCode).toBe(502);

    // The row is kept deliberately: if a failed send refunded the slot, anyone
    // could force failures to hammer the endpoint for free — and every retry
    // that DOES get through costs real money.
    expect(await codesFor("989138880003")).toBe(1);

    const second = await requestCode(phone);
    expect(second.statusCode).toBe(429);
    boom.mockRestore();
  });

  it("recovers on its own once the provider comes back", async () => {
    const phone = "09138880004";
    const boom = vi.spyOn(h.sms, "sendOtp").mockRejectedValueOnce(new Error("blip"));
    expect((await requestCode(phone)).statusCode).toBe(502);
    boom.mockRestore();

    // A provider blip must not poison the account. Once the per-minute window
    // passes, the next request goes through normally — no manual intervention,
    // no stuck state.
    await h.raw(
      `update otp_codes set created_at = now() - interval '2 minutes' where phone = '989138880004'`,
    );
    const retry = await requestCode(phone);
    expect(retry.statusCode).toBe(200);
    expect(h.sms.last()!.phone).toBe("989138880004");
  });

  it("a burst of DIFFERENT users is not blocked by one bad number", async () => {
    // Per-phone limits must not become a global outage. One number failing (or
    // being hammered) cannot stop everyone else signing up during a campaign.
    const bad = vi.spyOn(h.sms, "sendOtp").mockRejectedValueOnce(new Error("one bad number"));
    await requestCode("09138881000");
    bad.mockRestore();

    const others = await Promise.all(
      Array.from({ length: 10 }, (_, i) => requestCode(`0913888200${i}`)),
    );
    expect(others.every((r) => r.statusCode === 200)).toBe(true);
  });
});
