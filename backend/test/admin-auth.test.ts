import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";
import {
  adminOtpLedgerKey,
  adminPhoneMatches,
  adminSessionCookie,
  csrfCookie,
  issueAdminSession,
  newAdminCsrfToken,
  verifyAdminSession,
} from "../src/services/admin-auth.js";

const configuredPhone = "09120000123";
const sessionSecret = "s".repeat(48);
const env = loadEnv({
  NODE_ENV: "test",
  ADMIN_PHONE: configuredPhone,
  ADMIN_SESSION_SECRET: sessionSecret,
});
const now = new Date("2026-08-31T12:00:00.000Z");

describe("admin phone isolation", () => {
  it("accepts canonical variants but not another valid phone", () => {
    expect(adminPhoneMatches(env, "۰۹۱۲۰۰۰۰۱۲۳")).toBe(true);
    expect(adminPhoneMatches(env, "+989120000123")).toBe(true);
    expect(adminPhoneMatches(env, "09120000456")).toBe(false);
  });

  it("uses an opaque namespaced OTP ledger key", () => {
    const key = adminOtpLedgerKey(env);
    expect(key).toMatch(/^admin:[0-9a-f]{64}$/);
    expect(key).not.toContain("0912");
    expect(key).not.toContain("989120000123");
  });
});

describe("stateless admin session", () => {
  it("contains only the fixed admin role and expires after 90 days", async () => {
    const session = await issueAdminSession(env, now);
    const payload = decodeJwt(session.token);

    expect(payload.sub).toBe("admin");
    expect(payload.iss).toBe("routino-admin");
    expect(payload.aud).toBe("routino-admin-panel");
    expect(payload).not.toHaveProperty("phone");
    expect(Number(payload.exp) - Number(payload.iat)).toBe(90 * 86_400);
    expect(session.expiresAt.getTime()).toBe(now.getTime() + 90 * 86_400_000);
  });

  it("renews only inside the final 30 days", async () => {
    const session = await issueAdminSession(env, now);
    await expect(
      verifyAdminSession(env, session.token, new Date(now.getTime() + 60 * 86_400_000)),
    ).resolves.toMatchObject({ renew: false });
    await expect(
      verifyAdminSession(env, session.token, new Date(now.getTime() + 61 * 86_400_000)),
    ).resolves.toMatchObject({ renew: true });
  });

  it("rejects expiry and a token signed with another admin secret", async () => {
    const session = await issueAdminSession(env, now);
    const other = loadEnv({
      NODE_ENV: "test",
      ADMIN_PHONE: configuredPhone,
      ADMIN_SESSION_SECRET: "x".repeat(48),
    });
    await expect(verifyAdminSession(other, session.token, now)).rejects.toMatchObject({
      code: "invalid_admin_session",
    });
    await expect(
      verifyAdminSession(env, session.token, new Date(now.getTime() + 91 * 86_400_000)),
    ).rejects.toMatchObject({ code: "invalid_admin_session" });
  });
});

describe("admin cookies", () => {
  it("serializes the session and CSRF cookies with their exact security attributes", async () => {
    const session = await issueAdminSession(env, now);
    expect(adminSessionCookie(session.token, session.expiresAt)).toContain(
      "routino_admin_session=",
    );
    expect(adminSessionCookie(session.token, session.expiresAt)).toContain(
      "; Path=/; HttpOnly; Secure; SameSite=Strict",
    );

    const csrf = newAdminCsrfToken();
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(csrfCookie(csrf, session.expiresAt)).toContain("routino_admin_csrf=");
    expect(csrfCookie(csrf, session.expiresAt)).toContain("; Path=/; Secure; SameSite=Strict");
    expect(csrfCookie(csrf, session.expiresAt)).not.toContain("HttpOnly");
  });
});
