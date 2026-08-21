import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
const PHONE = "09123334444";

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

const descriptor = (installationKey: string) => ({
  installationKey,
  name: `Browser ${installationKey}`,
  platform: "web" as const,
  browser: "Chrome",
  os: "Windows",
});

async function login(installationKey: string) {
  await h.raw(`update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`);
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: PHONE } });
  return h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone: PHONE, code: h.sms.last()!.code, device: descriptor(installationKey) },
  });
}

async function successfulLogin(installationKey: string) {
  const response = await login(installationKey);
  expect(response.statusCode).toBe(200);
  return response.json() as { access: string; refresh: string; deviceId: string };
}

async function activeCount(): Promise<number> {
  const rows = await h.query<{ n: string }>(
    `select count(*)::text as n from devices where revoked_at is null`,
  );
  return Number(rows[0]!.n);
}

describe("device session security", () => {
  it("keeps every valid installation active when more devices sign in", async () => {
    const sessions = [];
    for (const key of ["device-a", "device-b", "device-c", "device-d"]) {
      sessions.push(await successfulLogin(key));
    }

    expect(await activeCount()).toBe(4);
    for (const session of sessions) {
      const response = await h.app.inject({
        method: "GET",
        url: "/v1/subscriptions/me",
        headers: { authorization: `Bearer ${session.access}` },
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it("reuses one installation row while rotating that installation's refresh token", async () => {
    const first = await successfulLogin("stable-key");
    const second = await successfulLogin("stable-key");

    expect(second.deviceId).toBe(first.deviceId);
    expect(await activeCount()).toBe(1);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/auth/token/refresh",
          payload: { refresh: first.refresh },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: "/v1/auth/token/refresh",
          payload: { refresh: second.refresh },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("does not let a legacy device-switch lock disable valid sessions", async () => {
    const first = await successfulLogin("phone-key");
    await h.raw(`
      update users set security_locked_at = now(), security_lock_reason = 'device_switch_limit';
      insert into device_security_events (user_id, kind) values
        ((select id from users where phone = '989123334444'), 'security_lock');
    `);

    const next = await login("laptop-key");
    expect(next.statusCode).toBe(200);
    const oldSession = await h.app.inject({
      method: "GET",
      url: "/v1/subscriptions/me",
      headers: { authorization: `Bearer ${first.access}` },
    });
    expect(oldSession.statusCode).toBe(200);
  });
});
