/** OTP sign-in, stateless token shape and guards — against the Edge app. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth, makeHarness, signIn, type Harness } from "./helpers/harness.ts";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

describe("POST /v1/auth/otp/request", () => {
  it("sends a code for a valid Iranian number (any input format)", async () => {
    const res = await h.call("POST", "/v1/auth/otp/request", { body: { phone: "۰۹۱۲۳۳۳۴۴۴۴" } });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(h.sms.last()!.phone).toBe("989123334444"); // normalized canonical form
    expect(h.sms.last()!.code).toMatch(/^\d{4}$/);
  });

  it("rejects an invalid phone", async () => {
    const res = await h.call("POST", "/v1/auth/otp/request", { body: { phone: "12345" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_phone");
  });

  it("rate-limits per phone per minute with Retry-After", async () => {
    await h.call("POST", "/v1/auth/otp/request", { body: { phone: "09123334444" } });
    const second = await h.call("POST", "/v1/auth/otp/request", { body: { phone: "09123334444" } });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
  });

  it("returns a clean 400 (not 500) on malformed JSON", async () => {
    const res = await h.app.request("/api/v1/auth/otp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
  });
});

describe("POST /v1/auth/otp/verify", () => {
  it("creates the account on first use with no entitlement or grant", async () => {
    const out = await signIn(h);
    expect(out.access).toEqual(expect.any(String));
    expect(out).not.toHaveProperty("refresh");
    expect(out).not.toHaveProperty("deviceId");
    expect(out.isNew).toBe(true);
    expect(out.user.phone).toBe("989123334444");
    expect(out.entitlement).toMatchObject({ status: "none", planId: null, expiresAt: null });

    const grants = await h.query<{ source: string }>(`select source from grants`);
    expect(grants).toEqual([]);
    expect(
      await h.query(`select table_name from information_schema.tables where table_name = 'devices'`),
    ).toHaveLength(0);
  });

  it("rejects a wrong code and burns attempts", async () => {
    await h.call("POST", "/v1/auth/otp/request", { body: { phone: "09123334444" } });
    const bad = await h.call("POST", "/v1/auth/otp/verify", {
      body: { phone: "09123334444", code: "000000" },
    });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error).toBe("bad_code");
  });

  it("does not create a grant on a second sign-in", async () => {
    await signIn(h);
    // Clear the OTP ledger so the second request isn't per-minute rate-limited —
    // in reality the second sign-in happens days later.
    await h.raw(`delete from otp_codes`);
    await signIn(h); // same phone, another sign-in
    const grants = await h.query(`select id from grants`);
    expect(grants).toHaveLength(0);
  });

  it("resets the password without revoking an existing stateless access token", async () => {
    const victim = await signIn(h);
    await h.raw(`delete from otp_codes`);

    await h.call("POST", "/v1/auth/otp/request", { body: { phone: victim.user.phone } });
    const resetResponse = await h.call("POST", "/v1/auth/otp/verify", {
      body: {
        phone: victim.user.phone,
        code: h.sms.last()!.code,
        intent: "password_reset",
        newPassword: "Naghmeh@1405",
      },
    });
    expect(resetResponse.status).toBe(200);
    expect(
      (await h.call("GET", "/v1/subscriptions/me", { headers: auth(victim.access) })).status,
    ).toBe(200);
  });
});

describe("removed session endpoints", () => {
  it("does not register refresh or server logout", async () => {
    expect(
      (await h.call("POST", "/v1/auth/token/refresh", { body: { refresh: "legacy" } })).status,
    ).toBe(404);
    expect((await h.call("POST", "/v1/auth/logout", { body: { refresh: "legacy" } })).status).toBe(
      404,
    );
  });
});

describe("authenticated route guard", () => {
  it("rejects a missing/garbage bearer token", async () => {
    expect((await h.call("GET", "/v1/subscriptions/me")).status).toBe(401);
    expect(
      (
        await h.call("GET", "/v1/subscriptions/me", {
          headers: { authorization: "Bearer garbage" },
        })
      ).status,
    ).toBe(401);
  });
});
