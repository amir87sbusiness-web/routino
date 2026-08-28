import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness({ TRUST_PROXY: "true" });
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

const request = (phone: string, ip = "203.0.113.42") =>
  h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/request",
    headers: { "x-forwarded-for": ip },
    payload: { phone },
  });

describe("OTP abuse limits", () => {
  it("stops a single IP after 20 different phone numbers in one hour", async () => {
    for (let i = 0; i < 20; i++) {
      const phone = `0912000${String(i).padStart(4, "0")}`;
      expect((await request(phone)).statusCode).toBe(200);
    }

    expect((await request("09129999999")).statusCode).toBe(429);
    expect(h.sms.sent).toHaveLength(20);
  });

  it("opens the global circuit breaker before a 2001st SMS can be sent", async () => {
    await h.raw(`
      insert into otp_codes (phone, code_hash, expires_at, created_at)
      select '989' || lpad(g::text, 9, '0'), 'test-hash', now() + interval '2 minutes', now()
      from generate_series(1, 2000) as g
    `);

    expect((await request("09129999999")).statusCode).toBe(429);
    expect(h.sms.sent).toHaveLength(0);
  });
});
