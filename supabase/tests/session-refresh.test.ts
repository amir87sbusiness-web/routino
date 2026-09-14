import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth, makeHarness, signIn, type Harness } from "./helpers/harness.ts";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

describe("POST /v1/auth/refresh", () => {
  it("requires an existing valid access token", async () => {
    expect((await h.call("POST", "/v1/auth/refresh")).status).toBe(401);
  });

  it("renews through the edge adapter without adding server-side session state", async () => {
    const signedIn = await signIn(h);
    const response = await h.call("POST", "/v1/auth/refresh", {
      headers: auth(signedIn.access),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      access: string;
      entitlement: { status: string; deletionAt?: string | null };
    };
    expect(body.access).toEqual(expect.any(String));
    expect(body.entitlement.status).toBe("none");
    expect(body.entitlement.deletionAt).toBe(signedIn.entitlement.deletionAt);
    expect(
      await h.query(`select table_name from information_schema.tables where table_name = 'sessions'`),
    ).toHaveLength(0);
  });
});
