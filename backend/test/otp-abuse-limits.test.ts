import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { acquireProviderLease, releaseProviderLease } from "../src/services/provider-capacity.js";
import { claimSendSlot } from "../src/services/otp.js";
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

  it("does not reject legitimate identities because of a fixed global daily quota", async () => {
    await h.raw(`
      insert into otp_codes (phone, code_hash, expires_at, created_at)
      select '989' || lpad(g::text, 9, '0'), 'test-hash', now() + interval '2 minutes', now()
      from generate_series(1, 2000) as g
    `);

    expect((await request("09129999999", "203.0.113.99")).statusCode).toBe(200);
    expect(h.sms.sent).toHaveLength(1);
  });

  it("atomically caps simultaneous different phones sharing one IP", async () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const outcomes = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        claimSendSlot(h.db, h.env, `98912${String(i).padStart(6, "0")}`, "203.0.113.77", now),
      ),
    );
    expect(outcomes.filter(Boolean)).toHaveLength(20);
  });

  it("does not consume an OTP claim while the SMS provider is saturated", async () => {
    const leases = [];
    const now = new Date();
    for (let i = 0; i < h.env.SMS_PROVIDER_MAX_CONCURRENCY; i++) {
      leases.push(
        (await acquireProviderLease(h.db, "sms", h.env.SMS_PROVIDER_MAX_CONCURRENCY, now, 30_000))!,
      );
    }

    const blocked = await request("09128888888", "203.0.113.88");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeTruthy();
    expect(await h.query(`select id from otp_codes where phone = '989128888888'`)).toHaveLength(0);

    await releaseProviderLease(h.db, "sms", leases[0]!.leaseId);
    expect((await request("09128888888", "203.0.113.88")).statusCode).toBe(200);
  });
});
