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
});
