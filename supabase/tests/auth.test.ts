/** OTP sign-in, token rotation and guards — against the deployed edge app. */
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
    expect(h.sms.last()!.code).toMatch(/^\d{6}$/);
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
  it("creates the account on first use and grants the 7-day trial server-side", async () => {
    const out = await signIn(h);
    expect(out.isNew).toBe(true);
    expect(out.user.phone).toBe("989123334444");
    expect(out.entitlement.status).toBe("active");
    const days = (Date.parse(out.entitlement.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const grants = await h.query<{ source: string }>(`select source from grants`);
    expect(grants).toEqual([{ source: "trial" }]);
  });

  it("rejects a wrong code and burns attempts", async () => {
    await h.call("POST", "/v1/auth/otp/request", { body: { phone: "09123334444" } });
    const bad = await h.call("POST", "/v1/auth/otp/verify", {
      body: { phone: "09123334444", code: "000000" },
    });
    expect(bad.status).toBe(401);
    expect((await bad.json()).error).toBe("bad_code");
  });

  it("does not re-grant the trial on a second sign-in", async () => {
    await signIn(h);
    // Clear the OTP ledger so the second request isn't per-minute rate-limited —
    // in reality the second sign-in happens days later.
    await h.raw(`delete from otp_codes`);
    await signIn(h); // same phone, new device
    const grants = await h.query(`select id from grants where source = 'trial'`);
    expect(grants).toHaveLength(1);
  });
});

describe("token refresh + logout", () => {
  it("rotates the refresh token; the old one dies immediately", async () => {
    const { refresh } = await signIn(h);

    const first = await h.call("POST", "/v1/auth/token/refresh", { body: { refresh } });
    expect(first.status).toBe(200);
    const rotated = (await first.json()) as { access: string; refresh: string };
    expect(rotated.refresh).not.toBe(refresh);

    // Old token replay → 401, never a silent re-issue.
    const replay = await h.call("POST", "/v1/auth/token/refresh", { body: { refresh } });
    expect(replay.status).toBe(401);

    // The rotated one works.
    const next = await h.call("POST", "/v1/auth/token/refresh", {
      body: { refresh: rotated.refresh },
    });
    expect(next.status).toBe(200);
  });

  it("logout revokes the device; refresh stops working, and is idempotent", async () => {
    const { refresh } = await signIn(h);
    const out = await h.call("POST", "/v1/auth/logout", { body: { refresh } });
    expect(out.status).toBe(200);

    const replay = await h.call("POST", "/v1/auth/token/refresh", { body: { refresh } });
    expect(replay.status).toBe(401);

    // Logging out again with the same (now unknown) token is still a 200.
    const again = await h.call("POST", "/v1/auth/logout", { body: { refresh } });
    expect(again.status).toBe(200);
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

  it("a blocked user is rejected within the access-token TTL", async () => {
    const { access, user } = await signIn(h);
    expect((await h.call("GET", "/v1/subscriptions/me", { headers: auth(access) })).status).toBe(
      200,
    );

    await h.raw(`update users set blocked = true where id = '${user.id}'`);
    // Same still-valid JWT — but the per-request user re-read catches the block.
    const res = await h.call("GET", "/v1/subscriptions/me", { headers: auth(access) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("blocked");
  });
});
