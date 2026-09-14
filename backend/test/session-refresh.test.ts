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

async function signIn(phone = "09123334444") {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const code = h.sms.last()!.code;
  const response = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    access: string;
    user: { id: string; phone: string };
    entitlement: { deletionAt?: string | null };
  };
}

describe("POST /v1/auth/refresh", () => {
  it("requires an existing valid access token", async () => {
    const response = await h.app.inject({ method: "POST", url: "/v1/auth/refresh" });
    expect(response.statusCode).toBe(401);
  });

  it("renews an authenticated session without creating server-side session state", async () => {
    const signedIn = await signIn();
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers: { authorization: `Bearer ${signedIn.access}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      access: string;
      entitlement: { status: string; deletionAt?: string | null };
    };
    expect(body.access).toEqual(expect.any(String));
    expect(body.entitlement.status).toBe("none");
    expect(body.entitlement.deletionAt).toBe(signedIn.entitlement.deletionAt);
    expect(
      await h.query(
        `select table_name from information_schema.tables where table_name = 'sessions'`,
      ),
    ).toHaveLength(0);
  });
});
