import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
let access: string;

beforeAll(async () => {
  h = await makeHarness();
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

describe("personal-data sync", () => {
  it("keeps authenticated sync available", async () => {
    const headers = { authorization: `Bearer ${access}` };
    const push = await h.app.inject({
      method: "POST",
      url: "/v1/sync/push",
      headers,
      payload: { records: [] },
    });
    const pull = await h.app.inject({ method: "GET", url: "/v1/sync/pull?cursor=0", headers });
    expect(push.statusCode).toBe(200);
    expect(pull.statusCode).toBe(200);
    expect(push.json()).toMatchObject({ applied: 0 });
    expect(pull.json()).toMatchObject({ records: [], reset: false });
  });
});
