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

const request = (phone: string) =>
  h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
const verify = (phone: string, code: string, deviceName?: string) =>
  h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code, deviceName },
  });

/** Full sign-in, returning the tokens. */
async function signIn(phone = "09123334444") {
  await request(phone);
  const code = h.sms.last()!.code;
  const res = await verify(phone, code);
  return res.json() as {
    access: string;
    user: { id: string; phone: string };
    entitlement: { status: string; planId: string | null; expiresAt: string | null };
    isNew: boolean;
  };
}

describe("POST /v1/auth/otp/request", () => {
  it("sends a 4-digit code to the canonical number", async () => {
    const res = await request("09123334444");
    expect(res.statusCode).toBe(200);
    expect(h.sms.sent).toHaveLength(1);
    // Normalised before hitting the provider AND the database.
    expect(h.sms.last()!.phone).toBe("989123334444");
    expect(h.sms.last()!.code).toMatch(/^\d{4}$/);
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
      await h.raw(
        `update otp_codes set created_at = now() - interval '2 minutes' where consumed_at is null`,
      );
    }
    const res = await request("09123334444");
    expect(res.statusCode).toBe(429);
    expect(h.sms.sent).toHaveLength(5);
  });
});

describe("POST /v1/auth/otp/verify", () => {
  it("returns one access token without refresh or device fields", async () => {
    const body = await signIn();

    expect(body).toMatchObject({
      access: expect.any(String),
      user: { id: expect.any(String), phone: "989123334444" },
    });
    expect(body).not.toHaveProperty("refresh");
    expect(body).not.toHaveProperty("deviceId");
    expect(
      await h.query(`select table_name from information_schema.tables where table_name = 'devices'`),
    ).toHaveLength(0);
  });

  it("creates the account with no entitlement or automatic grant", async () => {
    const body = await signIn();
    expect(body.isNew).toBe(true);
    expect(body.user.phone).toBe("989123334444");
    expect(body.entitlement).toMatchObject({ status: "none", planId: null, expiresAt: null });
    expect(await h.query(`select id from grants where user_id = '${body.user.id}'`)).toHaveLength(
      0,
    );
  });

  it("does not create a grant on a later sign-in", async () => {
    await signIn();
    await h.raw(
      `update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`,
    );
    const second = await signIn();

    expect(second.isNew).toBe(false);
    expect(second.entitlement.status).toBe("none");
    expect(await h.query(`select id from grants where user_id = '${second.user.id}'`)).toHaveLength(
      0,
    );
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

  it("locks out after 3 wrong attempts", async () => {
    await request("09123334444");
    const code = h.sms.last()!.code;
    for (let i = 0; i < 3; i++) await verify("09123334444", "0000");
    // Even the RIGHT code is refused once the budget is spent.
    const res = await verify("09123334444", code);
    expect(res.statusCode).toBe(429);
  });

  it("spends attempts atomically, so a burst cannot buy extra guesses", async () => {
    // Regression: the counter was written as `attempts = row.attempts + 1` after
    // a separate SELECT. Requests arriving together all read the same value and
    // all spent the same slot, turning "3 guesses" into "3 × however many you
    // send at once" against a 4-digit code with a 120-second life.
    await request("09123334444");
    const code = h.sms.last()!.code;

    const res = await Promise.all(Array.from({ length: 30 }, () => verify("09123334444", "0000")));
    const evaluated = res.filter((r) => r.statusCode === 401).length;
    expect(evaluated).toBeLessThanOrEqual(3);

    const [row] = await h.query<{ attempts: number }>(`select attempts from otp_codes limit 1`);
    expect(row!.attempts).toBe(3);
    expect((await verify("09123334444", code)).statusCode).toBe(429);
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
    await h.raw(
      `update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`,
    );
    await request("+989123334444");
    const res = await verify("+989123334444", h.sms.last()!.code);
    expect((res.json() as { isNew: boolean }).isNew).toBe(false);

    const rows = await h.query<{ n: number }>(`select count(*)::int as n from users`);
    expect(rows[0]!.n).toBe(1); // one human, one account
  });

  it("password recovery does not invalidate an existing access token", async () => {
    const existing = await signIn("09123334444");
    await h.raw(`update otp_codes set created_at = now() - interval '2 minutes'`);
    await request("09123334444");

    const reset = await h.app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "09123334444",
        code: h.sms.last()!.code,
        intent: "password_reset",
        newPassword: "Naghmeh@1405",
        deviceName: "recovery-device",
      },
    });
    expect(reset.statusCode).toBe(200);
    const protectedResponse = await h.app.inject({
      method: "GET",
      url: "/v1/subscriptions/me",
      headers: { authorization: `Bearer ${existing.access}` },
    });
    expect(protectedResponse.statusCode).toBe(200);
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
    expect((await h.app.inject({ method: "GET", url: "/v1/subscriptions/me" })).statusCode).toBe(
      401,
    );
    const res = await h.app.inject({
      method: "GET",
      url: "/v1/subscriptions/me",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("does not register refresh or logout endpoints", async () => {
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/auth/token/refresh",
          payload: { refresh: "legacy-refresh-token" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/auth/logout",
          payload: { refresh: "legacy-refresh-token" },
        })
      ).statusCode,
    ).toBe(404);
  });
});
