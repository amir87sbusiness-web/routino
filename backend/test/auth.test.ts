import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

const request = (phone: string) => h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
const verify = (phone: string, code: string, deviceName?: string) =>
  h.app.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: { phone, code, deviceName } });

/** Full sign-in, returning the tokens. */
async function signIn(phone = "09123334444") {
  await request(phone);
  const code = h.sms.last()!.code;
  const res = await verify(phone, code);
  return res.json() as {
    access: string;
    refresh: string;
    user: { id: string; phone: string };
    entitlement: { status: string; planId: string | null; expiresAt: string };
    isNew: boolean;
  };
}

describe("POST /v1/auth/otp/request", () => {
  it("sends a 6-digit code to the canonical number", async () => {
    const res = await request("09123334444");
    expect(res.statusCode).toBe(200);
    expect(h.sms.sent).toHaveLength(1);
    // Normalised before hitting the provider AND the database.
    expect(h.sms.last()!.phone).toBe("989123334444");
    expect(h.sms.last()!.code).toMatch(/^\d{6}$/);
  });

  it("accepts every form of the same number as one account", async () => {
    // The client sends whatever the user typed; Persian digits are routine.
    for (const p of ["09123334444", "+989123334444", "۰۹۱۲۳۳۳۴۴۴۴"]) {
      await h.truncate();
      await request(p);
      expect(h.sms.last()!.phone).toBe("989123334444");
    }
  });

  it("rejects a non-mobile number", async () => {
    const res = await request("0212223344");
    expect(res.statusCode).toBe(400);
    expect(h.sms.sent).toHaveLength(0);
  });

  it("never returns the code", async () => {
    const res = await request("09123334444");
    expect(JSON.stringify(res.json())).not.toContain(h.sms.last()!.code);
  });

  it("throttles a second request within a minute", async () => {
    // Every send costs real money at Kavenegar; this limit is the bill.
    await request("09123334444");
    const res = await request("09123334444");
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
    expect(h.sms.sent).toHaveLength(1);
  });

  it("throttles per hour across different minutes", async () => {
    // 5/hour. Backdate each row so the per-minute rule doesn't mask this.
    for (let i = 0; i < 5; i++) {
      await request("09123334444");
      await h.raw(`update otp_codes set created_at = now() - interval '2 minutes' where consumed_at is null`);
    }
    const res = await request("09123334444");
    expect(res.statusCode).toBe(429);
    expect(h.sms.sent).toHaveLength(5);
  });
});

describe("POST /v1/auth/otp/verify", () => {
  it("creates the account and grants a 7-day trial on first sign-in", async () => {
    const body = await signIn();
    expect(body.isNew).toBe(true);
    expect(body.user.phone).toBe("989123334444");
    expect(body.entitlement.status).toBe("active");
    expect(body.entitlement.planId).toBe("trial");

    const days = (Date.parse(body.entitlement.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("does not re-grant the trial on a later sign-in", async () => {
    // The old client wrote the trial locally, so clearing storage re-granted it
    // forever. The server must only ever grant it once.
    const first = await signIn();
    await h.raw(`update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`);
    const second = await signIn();

    expect(second.isNew).toBe(false);
    expect(second.entitlement.expiresAt).toBe(first.entitlement.expiresAt);
  });

  it("rejects a wrong code", async () => {
    await request("09123334444");
    const res = await verify("09123334444", "000000");
    expect(res.statusCode).toBe(401);
  });

  it("consumes the code — it cannot be replayed", async () => {
    await request("09123334444");
    const code = h.sms.last()!.code;
    expect((await verify("09123334444", code)).statusCode).toBe(200);
    expect((await verify("09123334444", code)).statusCode).toBe(401);
  });

  it("locks out after 5 wrong attempts", async () => {
    await request("09123334444");
    const code = h.sms.last()!.code;
    for (let i = 0; i < 5; i++) await verify("09123334444", "000000");
    // Even the RIGHT code is refused once the budget is spent.
    const res = await verify("09123334444", code);
    expect(res.statusCode).toBe(429);
  });

  it("rejects an expired code", async () => {
    await request("09123334444");
    const code = h.sms.last()!.code;
    await h.raw(`update otp_codes set expires_at = now() - interval '1 second'`);
    expect((await verify("09123334444", code)).statusCode).toBe(401);
  });

  it("invalidates the previous code when a new one is requested", async () => {
    // Otherwise each request buys the attacker another live guess.
    await request("09123334444");
    const first = h.sms.last()!.code;
    await h.raw(`update otp_codes set created_at = now() - interval '2 minutes'`);
    await request("09123334444");
    const second = h.sms.last()!.code;

    expect((await verify("09123334444", first)).statusCode).toBe(401);
    expect((await verify("09123334444", second)).statusCode).toBe(200);
  });

  it("signs in the same account regardless of how the number is typed", async () => {
    await signIn("09123334444");
    await h.raw(`update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`);
    await request("+989123334444");
    const res = await verify("+989123334444", h.sms.last()!.code);
    expect((res.json() as { isNew: boolean }).isNew).toBe(false);

    const rows = await h.query<{ n: number }>(`select count(*)::int as n from users`);
    expect(rows[0]!.n).toBe(1); // one human, one account
  });
});

describe("tokens", () => {
  it("issues a working access token", async () => {
    const { access } = await signIn();
    const res = await h.app.inject({
      method: "GET",
      url: "/v1/subscriptions/me",
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a missing or malformed token", async () => {
    expect((await h.app.inject({ method: "GET", url: "/v1/subscriptions/me" })).statusCode).toBe(401);
    const res = await h.app.inject({
      method: "GET",
      url: "/v1/subscriptions/me",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rotates the refresh token and kills the old one", async () => {
    const { refresh } = await signIn();
    const res = await h.app.inject({ method: "POST", url: "/v1/auth/token/refresh", payload: { refresh } });
    expect(res.statusCode).toBe(200);
    const next = res.json() as { access: string; refresh: string };
    expect(next.refresh).not.toBe(refresh);

    // The old token is dead the moment a new one is issued.
    const replay = await h.app.inject({ method: "POST", url: "/v1/auth/token/refresh", payload: { refresh } });
    expect(replay.statusCode).toBe(401);
  });

  it("gives each device its own refresh token", async () => {
    const a = await signIn();
    await h.raw(`update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`);
    const b = await signIn();
    expect(a.refresh).not.toBe(b.refresh);

    // Signing out one device must not sign out the other.
    await h.app.inject({ method: "POST", url: "/v1/auth/logout", payload: { refresh: a.refresh } });
    expect(
      (await h.app.inject({ method: "POST", url: "/v1/auth/token/refresh", payload: { refresh: a.refresh } })).statusCode,
    ).toBe(401);
    expect(
      (await h.app.inject({ method: "POST", url: "/v1/auth/token/refresh", payload: { refresh: b.refresh } })).statusCode,
    ).toBe(200);
  });

  it("refuses a blocked account", async () => {
    const { access, user } = await signIn();
    await h.raw(`update users set blocked = true where id = '${user.id}'`);
    // Re-read per request, so blocking takes effect inside the access TTL
    // rather than whenever the token happens to expire.
    const res = await h.app.inject({
      method: "GET",
      url: "/v1/subscriptions/me",
      headers: { authorization: `Bearer ${access}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("stores refresh tokens hashed, never in plaintext", async () => {
    const { refresh } = await signIn();
    const rows = await h.query<{ refresh_hash: string }>(`select refresh_hash from devices`);
    expect(rows[0]!.refresh_hash).not.toBe(refresh);
    expect(rows[0]!.refresh_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
