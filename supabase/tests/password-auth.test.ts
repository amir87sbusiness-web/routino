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
    expect((await login("09138982893", "Amir@1387")).status).toBe(200);
  });

  it("rejects a bad admin token", async () => {
    const res = await h.call("POST", "/v1/admin/users/set-password", {
      headers: { "x-admin-token": "wrong" },
      body: { phone: "09138982893", password: "Amir@1387" },
    });
    expect(res.status).toBe(401);
  });
});

describe("edge: changing a password evicts other sessions", () => {
  it("revokes every other device's refresh token but keeps the caller signed in", async () => {
    // The edge function is what production actually runs, and its routes/ files
    // are hand-mirrored from the Fastify ones (only shared/ is generated), so
    // this fix needs its own coverage here rather than relying on parity.
    const victim = await signIn(h, "09123334444");
    expect(
      (await h.call("POST", "/v1/auth/password", {
        headers: auth(victim.access),
        body: { newPassword: "Amir@1387" },
      })).status,
    ).toBe(200);

    // Intruder signs in with the leaked password on their own device.
    const intruder = (await login("09123334444", "Amir@1387")).clone();
    const intruderRefresh = (await intruder.json()).refresh as string;
    expect(intruderRefresh).toBeTruthy();

    // Victim changes the password from the device in their hand.
    expect(
      (await h.call("POST", "/v1/auth/password", {
        headers: auth(victim.access),
        body: { newPassword: "Naghmeh@1405", currentPassword: "Amir@1387" },
      })).status,
    ).toBe(200);

    // Intruder is out.
    const stolen = await h.call("POST", "/v1/auth/token/refresh", {
      body: { refresh: intruderRefresh },
    });
    expect(stolen.status).toBe(401);

    // Victim is not signed out of their own device.
    const own = await h.call("POST", "/v1/auth/token/refresh", {
      body: { refresh: victim.refresh },
    });
    expect(own.status).toBe(200);
  });
});
