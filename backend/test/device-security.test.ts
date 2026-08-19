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
  platform: "web",
  browser: "Chrome",
  os: "Windows",
});

async function login(installationKey: string) {
  await h.raw(`update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`);
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: PHONE } });
  const code = h.sms.last()!.code;
  return h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone: PHONE, code, device: descriptor(installationKey) },
  });
}

async function successfulLogin(installationKey: string) {
  const response = await login(installationKey);
  expect(response.statusCode).toBe(200);
  return response.json() as { access: string; refresh: string; deviceId: string };
}

async function eventCount(): Promise<number> {
  const rows = await h.query<{ n: string }>(
    `select count(*)::text as n from device_security_events where kind = 'replacement'`,
  );
  return Number(rows[0]!.n);
}

async function activeCount(): Promise<number> {
  const rows = await h.query<{ n: string }>(
    `select count(*)::text as n from devices where revoked_at is null`,
  );
  return Number(rows[0]!.n);
}

describe("device security policy", () => {
  it("defaults to one active device and revokes the previous session", async () => {
    const first = await successfulLogin("phone-key");
    await successfulLogin("laptop-key");

    expect(await activeCount()).toBe(1);
    const oldRequest = await h.app.inject({
      method: "GET",
      url: "/v1/subscriptions/me",
      headers: { authorization: `Bearer ${first.access}` },
    });
    expect(oldRequest.statusCode).toBe(401);
    expect(oldRequest.json().error).toBe("device_replaced");
  });

  it("does not count or duplicate a relogin from the same installation", async () => {
    const first = await successfulLogin("stable-key");
    const second = await successfulLogin("stable-key");

    expect(second.deviceId).toBe(first.deviceId);
    expect(await activeCount()).toBe(1);
    expect(await eventCount()).toBe(0);
  });

  it("allows three replacements in a rolling 30-day window and locks the fourth", async () => {
    await successfulLogin("device-a");
    await successfulLogin("device-b");
    await successfulLogin("device-c");
    await successfulLogin("device-d");
    expect(await eventCount()).toBe(3);

    const fourth = await login("device-e");
    expect(fourth.statusCode).toBe(423);
    expect(fourth.json()).toMatchObject({
      error: "device_security_locked",
      support: "routino_support",
    });
    expect(await activeCount()).toBe(0);

    const users = await h.query<{ security_locked_at: string | null }>(
      `select security_locked_at from users`,
    );
    expect(users[0]!.security_locked_at).not.toBeNull();
  });

  it("does not count devices that fill an admin-granted free slot", async () => {
    await successfulLogin("device-a");
    await h.raw(`update users set max_active_devices = 2`);
    await successfulLogin("device-b");
    expect(await activeCount()).toBe(2);
    expect(await eventCount()).toBe(0);

    await successfulLogin("device-c");
    expect(await activeCount()).toBe(2);
    expect(await eventCount()).toBe(1);
  });

  it("ignores replacement events older than 15 days", async () => {
    await successfulLogin("device-a");
    await successfulLogin("device-b");
    await successfulLogin("device-c");
    await successfulLogin("device-d");
    await h.raw(`update device_security_events set created_at = now() - interval '16 days'`);

    const response = await login("device-e");
    expect(response.statusCode).toBe(200);
    expect(await activeCount()).toBe(1);
  });
});
