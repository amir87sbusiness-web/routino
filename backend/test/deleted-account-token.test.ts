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

async function deletedAccountToken() {
  const phone = "09125556677";
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const signedIn = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  const body = signedIn.json() as { access: string; user: { id: string } };
  await h.script(`delete from users where id = '${body.user.id}'`);
  return body.access;
}

describe("deleted account access tokens", () => {
  it.each([
    {
      label: "username update",
      method: "POST" as const,
      url: "/v1/auth/username",
      payload: { username: "deleted_user" },
    },
    {
      label: "trial start",
      method: "POST" as const,
      url: "/v1/subscriptions/trial/start",
      payload: undefined,
    },
    {
      label: "legacy import",
      method: "POST" as const,
      url: "/v1/subscriptions/import",
      payload: { planId: "legacy", expiresAt: Date.now() + 86_400_000 },
    },
    {
      label: "grant ledger",
      method: "GET" as const,
      url: "/v1/subscriptions/grants",
      payload: undefined,
    },
    {
      label: "payment poll",
      method: "GET" as const,
      url: `/v1/payments/${crypto.randomUUID()}`,
      payload: undefined,
    },
  ])("rejects $label through its existing database query", async ({ method, url, payload }) => {
    const access = await deletedAccountToken();
    const response = await h.app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${access}` },
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unknown_user" });
  });
});
