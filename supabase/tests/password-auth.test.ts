/** Password sign-in + admin set-password against the deployed edge (Hono) app. */
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

const ADMIN = "dev-only-admin-token";

const login = (identifier: string, password: string) =>
  h.call("POST", "/v1/auth/password/login", { body: { identifier, password } });

describe("edge password sign-in", () => {
  it("set a password via the app, then sign in with it", async () => {
    const { access } = await signIn(h, "09123334444");
    const set = await h.call("POST", "/v1/auth/password", {
      headers: auth(access),
      body: { newPassword: "Amir@1387" },
    });
    expect(set.status).toBe(200);

    const res = await login("09123334444", "Amir@1387");
    expect(res.status).toBe(200);
    expect((await res.json()).user.phone).toBe("989123334444");
  });

  it("rejects a wrong password with bad_credentials", async () => {
    const { access } = await signIn(h, "09123334444");
    await h.call("POST", "/v1/auth/password", {
      headers: auth(access),
      body: { newPassword: "Amir@1387" },
    });
    const res = await login("09123334444", "nope123456");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("bad_credentials");
  });

  it("username sign-in works", async () => {
    const { access } = await signIn(h, "09123334444");
    await h.call("POST", "/v1/auth/password", {
      headers: auth(access),
      body: { newPassword: "Amir@1387" },
    });
    await h.call("POST", "/v1/auth/username", {
      headers: auth(access),
      body: { username: "Amir" },
    });
    const res = await login("amir", "Amir@1387");
    expect(res.status).toBe(200);
  });

  it("rejects a reserved username (admin)", async () => {
    const { access } = await signIn(h, "09123334444");
    const res = await h.call("POST", "/v1/auth/username", {
      headers: auth(access),
      body: { username: "Admin" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("username_reserved");
  });
});

describe("edge admin set-password", () => {
  it("creates an account with a password and it can sign in", async () => {
    const res = await h.call("POST", "/v1/admin/users/set-password", {
      headers: { "x-admin-token": ADMIN },
      body: { phone: "09138982893", password: "Amir@1387" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(true);
    const signedIn = await login("09138982893", "Amir@1387");
    expect(signedIn.status).toBe(200);
    expect((await signedIn.json()).entitlement).toMatchObject({
      status: "none",
      planId: null,
      expiresAt: null,
    });
    expect(await h.query(`select id from grants`)).toHaveLength(0);
    expect(await h.query(`select user_id from entitlements`)).toHaveLength(0);
  });

  it("rejects a bad admin token", async () => {
    const res = await h.call("POST", "/v1/admin/users/set-password", {
      headers: { "x-admin-token": "wrong" },
      body: { phone: "09138982893", password: "Amir@1387" },
    });
    expect(res.status).toBe(401);
  });
});

describe("edge stateless password sessions", () => {
  it("keeps already-issued access tokens valid after a password change", async () => {
    // The edge function is what production actually runs, and its routes/ files
    // are hand-mirrored from the Fastify ones (only shared/ is generated), so
    // this fix needs its own coverage here rather than relying on parity.
    const victim = await signIn(h, "09123334444");
    expect(
      (
        await h.call("POST", "/v1/auth/password", {
          headers: auth(victim.access),
          body: { newPassword: "Amir@1387" },
        })
      ).status,
    ).toBe(200);
    const intruder = (await login("09123334444", "Amir@1387")).clone();
    const intruderAccess = (await intruder.json()).access as string;
    expect(intruderAccess).toBeTruthy();

    // Victim changes the password from the device in their hand.
    expect(
      (
        await h.call("POST", "/v1/auth/password", {
          headers: auth(victim.access),
          body: { newPassword: "Naghmeh@1405", currentPassword: "Amir@1387" },
        })
      ).status,
    ).toBe(200);

    expect(
      (await h.call("GET", "/v1/subscriptions/me", { headers: auth(intruderAccess) })).status,
    ).toBe(200);
    expect(
      (await h.call("GET", "/v1/subscriptions/me", { headers: auth(victim.access) })).status,
    ).toBe(200);
  });
});
