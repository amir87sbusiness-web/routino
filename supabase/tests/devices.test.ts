import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth, makeHarness, signIn, type Harness } from "./helpers/harness.ts";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => h?.close());

describe("edge device ping", () => {
  it("confirms the current session without returning account or device-list data", async () => {
    const current = await signIn(h);
    const response = await h.call("GET", "/v1/devices/ping", {
      headers: auth(current.access),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns the structured security error after revocation", async () => {
    const current = await signIn(h);
    await h.raw(
      `update devices set revoked_at = now(), revocation_reason = 'user_revoked' where id = '${current.deviceId}'`,
    );
    const response = await h.call("GET", "/v1/devices/ping", {
      headers: auth(current.access),
    });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("device_revoked");
  });

  it("lists devices without retired quota counters", async () => {
    const current = await signIn(h);
    const response = await h.call("GET", "/v1/devices", { headers: auth(current.access) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("maxActiveDevices");
    expect(body).not.toHaveProperty("switchCount30d");
    expect(body).not.toHaveProperty("securityLocked");
    expect(body.devices).toHaveLength(1);
  });

  it("does not let a legacy device-switch lock reject a valid session", async () => {
    const current = await signIn(h);
    await h.raw(
      `update users set security_locked_at = now(), security_lock_reason = 'device_switch_limit' where id = '${current.user.id}'`,
    );
    const response = await h.call("GET", "/v1/devices/ping", { headers: auth(current.access) });
    expect(response.status).toBe(200);
  });
});
