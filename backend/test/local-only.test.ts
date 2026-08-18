import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
let access: string;

beforeAll(async () => {
  h = await makeHarness({ LEGACY_PERSONAL_SYNC_ENABLED: "false" });
  await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/request",
    payload: { phone: "09121112233" },
  });
  const response = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone: "09121112233", code: h.sms.last()!.code },
  });
  access = (response.json() as { access: string }).access;
});

afterAll(async () => h.close());

describe("local-only personal data", () => {
  it("retires both legacy personal-record sync endpoints", async () => {
    const headers = { authorization: `Bearer ${access}` };
    const push = await h.app.inject({
      method: "POST",
      url: "/v1/sync/push",
      headers,
      payload: { records: [] },
    });
    const pull = await h.app.inject({ method: "GET", url: "/v1/sync/pull?cursor=0", headers });
    expect(push.statusCode).toBe(410);
    expect(pull.statusCode).toBe(410);
    expect(push.json()).toMatchObject({ error: "sync_disabled" });
  });
});
