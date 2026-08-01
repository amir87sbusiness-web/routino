/** Password sign-in, credential management, admin set-password, and the
 * brute-force limits — driven through the real Fastify app. */
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

const ADMIN = "dev-only-admin-token";

/** OTP sign-in, returning the tokens. */
async function otpSignIn(phone = "09123334444") {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const code = h.sms.last()!.code;
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code },
  });
  return res.json() as { access: string; user: { id: string; phone: string } };
}

const login = (identifier: string, password: string) =>
  h.app.inject({
    method: "POST",
    url: "/v1/auth/password/login",
    payload: { identifier, password },
  });

const setPw = (access: string, newPassword: string, currentPassword?: string) =>
  h.app.inject({
    method: "POST",
    url: "/v1/auth/password",
    headers: { authorization: `Bearer ${access}` },
    payload: { newPassword, currentPassword },
  });

const setName = (access: string, username: string) =>
  h.app.inject({
    method: "POST",
    url: "/v1/auth/username",
    headers: { authorization: `Bearer ${access}` },
    payload: { username },
  });

const adminSetPw = (phone: string, password: string) =>
  h.app.inject({
    method: "POST",
    url: "/v1/admin/users/set-password",
    headers: { "x-admin-token": ADMIN },
    payload: { phone, password },
  });

describe("setting a password then signing in with it", () => {
  it("lets an OTP user set a password and sign in with phone + password", async () => {
    const { access } = await otpSignIn("09123334444");
    expect((await setPw(access, "Amir@1387")).statusCode).toBe(200);

    const res = await login("09123334444", "Amir@1387");
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      user: { phone: string };
      access: string;
      entitlement: { status: string };
    };
    expect(body.user.phone).toBe("989123334444");
    expect(body.access).toBeTruthy();
  });

  it("accepts any input format of the phone as the identifier", async () => {
    const { access } = await otpSignIn("09123334444");
    await setPw(access, "Amir@1387");
    for (const id of ["09123334444", "+989123334444", "۰۹۱۲۳۳۳۴۴۴۴"]) {
      expect((await login(id, "Amir@1387")).statusCode).toBe(200);
    }
  });

  it("rejects a wrong password", async () => {
    const { access } = await otpSignIn("09123334444");
    await setPw(access, "Amir@1387");
    const res = await login("09123334444", "wrongpass1");
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe("bad_credentials");
  });

  it("gives the SAME error for an unknown account and a wrong password (no enumeration)", async () => {
    const unknown = await login("09120000000", "whatever12");
    const { access } = await otpSignIn("09123334444");
    await setPw(access, "Amir@1387");
    const wrong = await login("09123334444", "whatever12");
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect((unknown.json() as { error: string }).error).toBe(
      (wrong.json() as { error: string }).error,
    );
  });

  it("stores only a scrypt hash, never the raw password", async () => {
    const { access } = await otpSignIn("09123334444");
    await setPw(access, "Amir@1387");
    const rows = await h.query<{ password_hash: string }>(`select password_hash from users`);
    expect(rows[0]!.password_hash).toMatch(/^scrypt\$/);
    expect(rows[0]!.password_hash).not.toContain("Amir@1387");
  });

  it("rejects a weak password", async () => {
    const { access } = await otpSignIn("09123334444");
    expect((await setPw(access, "short")).statusCode).toBe(400);
    expect((await setPw(access, "allletters")).statusCode).toBe(400); // no digit
  });

  it("requires the current password to CHANGE an existing one", async () => {
    const { access } = await otpSignIn("09123334444");
    await setPw(access, "Amir@1387");
    // Wrong current → rejected.
    expect((await setPw(access, "NewPass99", "nope")).statusCode).toBe(401);
    // Correct current → accepted, and the new one works.
    expect((await setPw(access, "NewPass99", "Amir@1387")).statusCode).toBe(200);
    expect((await login("09123334444", "NewPass99")).statusCode).toBe(200);
    expect((await login("09123334444", "Amir@1387")).statusCode).toBe(401);
  });
});

describe("username", () => {
  it("can be set and used to sign in", async () => {
    const { access } = await otpSignIn("09123334444");
    await setPw(access, "Amir@1387");
    expect((await setName(access, "Amir")).statusCode).toBe(200); // lowercased server-side

    const res = await login("amir", "Amir@1387");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { user: { phone: string } }).user.phone).toBe("989123334444");
  });

  it("rejects an invalid username and a duplicate", async () => {
    const a = await otpSignIn("09123334444");
    expect((await setName(a.access, "1abc")).statusCode).toBe(400); // must start with a letter
    expect((await setName(a.access, "amir")).statusCode).toBe(200);

    const b = await otpSignIn("09121112233");
    const dup = await setName(b.access, "AMIR");
    expect(dup.statusCode).toBe(400);
    expect((dup.json() as { error: string }).error).toBe("username_taken");
  });

  it("reserves impersonation-prone names like admin (any case)", async () => {
    const { access } = await otpSignIn("09123334444");
    for (const name of ["admin", "Admin", "ADMIN", "support", "root", "routino"]) {
      const res = await setName(access, name);
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toBe("username_reserved");
    }
    // A normal name is still fine.
    expect((await setName(access, "amir")).statusCode).toBe(200);
  });

  it("reserves lookalikes and staff-flavoured compounds too", async () => {
    // Regression: `adm1n` sailed straight through the exact-match list. Somebody
    // messaging users as apparent staff is a real risk precisely because those
    // users are about to send money through the app.
    const { access } = await otpSignIn("09123334444");
    for (const name of ["adm1n", "supp0rt", "r00t", "routino_support", "official.team", "admin.routino"]) {
      const res = await setName(access, name);
      expect(res.statusCode, name).toBe(400);
      expect((res.json() as { error: string }).error, name).toBe("username_reserved");
    }
    // Ordinary names that merely contain a digit are untouched.
    for (const name of ["amir1387", "sara.k", "ali_92"]) {
      expect((await setName(access, name)).statusCode, name).toBe(200);
    }
  });

  it("reports account credential state", async () => {
    const { access } = await otpSignIn("09123334444");
    const before = await h.app.inject({
      method: "GET",
      url: "/v1/auth/account",
      headers: { authorization: `Bearer ${access}` },
    });
    expect(before.json()).toMatchObject({
      phone: "989123334444",
      username: null,
      hasPassword: false,
    });
    await setPw(access, "Amir@1387");
    await setName(access, "amir");
    const after = await h.app.inject({
      method: "GET",
      url: "/v1/auth/account",
      headers: { authorization: `Bearer ${access}` },
    });
    expect(after.json()).toMatchObject({ username: "amir", hasPassword: true });
  });
});

describe("admin set-password", () => {
  it("creates an account with a password and a trial when none exists", async () => {
    const res = await adminSetPw("09138982893", "Amir@1387");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { created: boolean }).created).toBe(true);

    const login1 = await login("09138982893", "Amir@1387");
    expect(login1.statusCode).toBe(200);
    // Trial granted so the account is actually usable after logging in.
    expect((login1.json() as { entitlement: { status: string } }).entitlement.status).toBe(
      "active",
    );
  });

  it("resets the password of an existing account", async () => {
    const { access } = await otpSignIn("09138982893");
    await setPw(access, "OldPass11");
    const res = await adminSetPw("09138982893", "Amir@1387");
    expect((res.json() as { created: boolean }).created).toBe(false);
    expect((await login("09138982893", "Amir@1387")).statusCode).toBe(200);
    expect((await login("09138982893", "OldPass11")).statusCode).toBe(401);
  });

  it("signs every existing device out when an admin resets the password", async () => {
    // Support presses this button precisely when a user reports someone got
    // into their account. Refresh tokens live 180 days and rotate silently, so
    // if they survive the reset the intruder simply keeps refreshing.
    await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: "09138982893" } });
    const intruder = (
      await h.app.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        payload: { phone: "09138982893", code: h.sms.last()!.code },
      })
    ).json() as { refresh: string };
    expect(intruder.refresh).toBeTruthy();

    expect((await adminSetPw("09138982893", "Amir@1387")).statusCode).toBe(200);

    const stolen = await h.app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refresh: intruder.refresh },
    });
    expect(stolen.statusCode).toBe(401);
  });

  it("needs a valid admin token", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/admin/users/set-password",
      headers: { "x-admin-token": "wrong" },
      payload: { phone: "09138982893", password: "Amir@1387" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("brute-force throttling", () => {
  it("throttles wrong passwords but never locks out the real owner", async () => {
    const { access } = await otpSignIn("09123334444");
    await setPw(access, "Amir@1387");
    // 8 failures allowed in the window; the 9th wrong guess is throttled.
    for (let i = 0; i < 8; i++)
      expect((await login("09123334444", "bad-guess1")).statusCode).toBe(401);
    const limited = await login("09123334444", "bad-guess1");
    expect(limited.statusCode).toBe(429);

    // ...but the CORRECT password still gets in. A flat lockout here meant
    // anyone who knew a customer's phone number could keep them out of their own
    // account indefinitely with eight wrong guesses every 15 minutes.
    expect((await login("09123334444", "Amir@1387")).statusCode).toBe(200);
  });

  it("blocks even a correct password past the hard limit", async () => {
    const { access } = await otpSignIn("09123334444");
    await setPw(access, "Amir@1387");
    // The soft limit protects the owner; the hard limit protects the CPU, since
    // every attempt costs one deliberately-slow scrypt.
    for (let i = 0; i < 50; i++) await login("09123334444", "bad-guess1");
    expect((await login("09123334444", "Amir@1387")).statusCode).toBe(429);
  });

  it("a correct password clears the failure counter", async () => {
    const { access } = await otpSignIn("09123334444");
    await setPw(access, "Amir@1387");
    for (let i = 0; i < 5; i++) await login("09123334444", "bad-guess1");
    expect((await login("09123334444", "Amir@1387")).statusCode).toBe(200);
    // Counter reset — a fresh run of wrong guesses is allowed again.
    for (let i = 0; i < 8; i++)
      expect((await login("09123334444", "bad-guess1")).statusCode).toBe(401);
  });
});

describe("changing a password evicts other sessions", () => {
  it("revokes every other device's refresh token but keeps the caller signed in", async () => {
    // A password change is how a user throws out someone who got into their
    // account. Refresh tokens live 180 days and rotate silently, so if they
    // survive the change the intruder simply keeps refreshing and the new
    // password protects nothing.
    await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: "09123334444" } });
    const victim = (
      await h.app.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        payload: { phone: "09123334444", code: h.sms.last()!.code },
      })
    ).json() as { access: string; refresh: string };
    expect((await setPw(victim.access, "Amir@1387")).statusCode).toBe(200);

    // The intruder signs in with the leaked password on their own device.
    const intruder = (await login("09123334444", "Amir@1387")).json() as { refresh: string };
    expect(intruder.refresh).toBeTruthy();

    // The victim changes the password from the device they are holding.
    expect((await setPw(victim.access, "Naghmeh@1405", "Amir@1387")).statusCode).toBe(200);

    // The intruder is out: their refresh token no longer rotates.
    const stolen = await h.app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refresh: intruder.refresh },
    });
    expect(stolen.statusCode).toBe(401);

    // ...and the victim is NOT signed out of the phone they just used.
    const own = await h.app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refresh: victim.refresh },
    });
    expect(own.statusCode).toBe(200);
  });
});
