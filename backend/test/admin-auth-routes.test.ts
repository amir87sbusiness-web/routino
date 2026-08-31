import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => h?.close());

const ownerPhone = "09120000123";

const cookiePair = (setCookie: string | string[] | undefined) => {
  const lines = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const values = lines.map((line) => line.split(";", 1)[0]!);
  return {
    header: values.join("; "),
    csrf: values.find((value) => value.startsWith("routino_admin_csrf="))?.split("=")[1] ?? "",
    lines,
  };
};

async function adminLogin() {
  await h.app.inject({
    method: "POST",
    url: "/v1/admin/auth/otp/request",
    payload: { phone: ownerPhone },
  });
  const code = h.sms.last()!.code;
  const verified = await h.app.inject({
    method: "POST",
    url: "/v1/admin/auth/otp/verify",
    payload: { phone: ownerPhone, code },
  });
  return { verified, ...cookiePair(verified.headers["set-cookie"]) };
}

describe("admin OTP routes", () => {
  it("returns the same response for wrong and permitted phones but sends only to the permitted one", async () => {
    const wrong = await h.app.inject({
      method: "POST",
      url: "/v1/admin/auth/otp/request",
      payload: { phone: "09120000456" },
    });
    expect(h.sms.sent).toHaveLength(0);

    const correct = await h.app.inject({
      method: "POST",
      url: "/v1/admin/auth/otp/request",
      payload: { phone: ownerPhone },
    });
    expect(h.sms.sent).toHaveLength(1);
    expect(correct.statusCode).toBe(202);
    expect(wrong.statusCode).toBe(correct.statusCode);
    expect(wrong.body).toBe(correct.body);
  });

  it("keeps admin and user OTP codes in separate namespaces", async () => {
    await h.app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: ownerPhone },
    });
    const userCode = h.sms.last()!.code;
    const adminWithUserCode = await h.app.inject({
      method: "POST",
      url: "/v1/admin/auth/otp/verify",
      payload: { phone: ownerPhone, code: userCode },
    });
    expect(adminWithUserCode.statusCode).toBe(401);

    await h.raw(`update otp_codes set created_at = now() - interval '2 minutes'`);
    await h.app.inject({
      method: "POST",
      url: "/v1/admin/auth/otp/request",
      payload: { phone: ownerPhone },
    });
    const adminCode = h.sms.last()!.code;
    const userWithAdminCode = await h.app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: { phone: ownerPhone, code: adminCode },
    });
    expect(userWithAdminCode.statusCode).toBe(401);
  });

  it("issues secure cookies, restores the session, and rejects the legacy header", async () => {
    const login = await adminLogin();
    expect(login.verified.statusCode).toBe(200);
    expect(login.lines.join("\n")).toContain("HttpOnly; Secure; SameSite=Strict");
    expect(login.lines.join("\n")).toContain("routino_admin_csrf=");

    const session = await h.app.inject({
      method: "GET",
      url: "/v1/admin/auth/session",
      headers: { cookie: login.header },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ authenticated: true });

    expect(
      (
        await h.app.inject({
          method: "GET",
          url: "/v1/admin/overview",
          headers: { "x-admin-token": "retired-shared-secret" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("requires matching CSRF for mutations and clears cookies on logout", async () => {
    const login = await adminLogin();
    const noCsrf = await h.app.inject({
      method: "POST",
      url: "/v1/admin/discounts",
      headers: { cookie: login.header },
      payload: { code: "SAFE30", percent: 30 },
    });
    expect(noCsrf.statusCode).toBe(403);

    const accepted = await h.app.inject({
      method: "POST",
      url: "/v1/admin/discounts",
      headers: { cookie: login.header, "x-admin-csrf": login.csrf },
      payload: { code: "SAFE30", percent: 30 },
    });
    expect(accepted.statusCode).toBe(200);

    const logout = await h.app.inject({
      method: "POST",
      url: "/v1/admin/auth/logout",
      headers: { cookie: login.header, "x-admin-csrf": login.csrf },
    });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");
  });
});
