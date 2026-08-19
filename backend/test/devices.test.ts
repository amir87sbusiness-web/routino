import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
const PHONE = "09123334444";

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => h?.close());

async function login(key: string) {
  await h.raw(`update otp_codes set created_at = now() - interval '2 minutes'`);
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: PHONE } });
  const response = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: {
      phone: PHONE,
      code: h.sms.last()!.code,
      device: { installationKey: key, name: key, platform: "web", browser: "Chrome", os: "Windows" },
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { access: string; deviceId: string };
}

describe("device APIs", () => {
  it("pings the current device without returning the expensive device overview", async () => {
    const current = await login("current-device-key");
    const response = await h.app.inject({
      method: "GET",
      url: "/v1/devices/ping",
      headers: { authorization: `Bearer ${current.access}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("rejects a ping as soon as the current device is revoked", async () => {
    const current = await login("current-device-key");
    await h.raw(
      `update devices set revoked_at = now(), revocation_reason = 'user_revoked' where id = '${current.deviceId}'`,
    );
    const response = await h.app.inject({
      method: "GET",
      url: "/v1/devices/ping",
      headers: { authorization: `Bearer ${current.access}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("device_revoked");
  });

  it("lists safe presentation fields and identifies the current device", async () => {
    const current = await login("current-device-key");
    const response = await h.app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: { authorization: `Bearer ${current.access}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown> & { devices: Record<string, unknown>[] };
    expect(body).toMatchObject({ maxActiveDevices: 1, switchCount30d: 0, securityLocked: false });
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]).toMatchObject({
      id: current.deviceId,
      name: "current-device-key",
      platform: "web",
      browser: "Chrome",
      os: "Windows",
      current: true,
      active: true,
    });
    expect(body.devices[0]).not.toHaveProperty("refreshHash");
    expect(body.devices[0]).not.toHaveProperty("installationKeyHash");
  });

  it("lets a user revoke another one of their active devices", async () => {
    const first = await login("first-device-key");
    await h.raw(`update users set max_active_devices = 2`);
    const current = await login("current-device-key");

    const response = await h.app.inject({
      method: "POST",
      url: `/v1/devices/${first.deviceId}/revoke`,
      headers: { authorization: `Bearer ${current.access}` },
    });
    expect(response.statusCode).toBe(200);
    const rows = await h.query<{ revocation_reason: string | null }>(
      `select revocation_reason from devices where id = '${first.deviceId}' and revoked_at is not null`,
    );
    expect(rows[0]!.revocation_reason).toBe("user_revoked");
  });

  it("does not reveal whether another user's device id exists", async () => {
    const current = await login("current-device-key");
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/devices/00000000-0000-4000-8000-000000000000/revoke",
      headers: { authorization: `Bearer ${current.access}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("unknown_device");
  });
});
