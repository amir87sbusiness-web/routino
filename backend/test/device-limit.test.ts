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

async function signIn(name: string) {
  await h.raw(`update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`);
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: PHONE } });
  const response = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: {
      phone: PHONE,
      code: h.sms.last()!.code,
      device: { installationKey: `test-key-${name}`, name, platform: "web" },
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { refresh: string; deviceId: string };
}

describe("unlimited device installations", () => {
  it("does not revoke earlier refresh sessions when a fourth installation signs in", async () => {
    const sessions = [];
    for (const name of ["phone", "laptop", "tablet", "desktop"]) sessions.push(await signIn(name));

    const active = await h.query<{ id: string }>(`select id from devices where revoked_at is null`);
    expect(active.map((device) => device.id).sort()).toEqual(
      sessions.map((session) => session.deviceId).sort(),
    );
    for (const session of sessions) {
      expect(
        (
          await h.app.inject({
            method: "POST",
            url: "/v1/auth/token/refresh",
            payload: { refresh: session.refresh },
          })
        ).statusCode,
      ).toBe(200);
    }
  });
});
