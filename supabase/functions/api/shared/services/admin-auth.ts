// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/** Stateless owner-admin authentication primitives shared by Fastify and Edge. */
import { Buffer } from "node:buffer";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Env } from "../env.ts";
import { unauthorized } from "../lib/http-errors.ts";
import { normalizePhone } from "../lib/phone.ts";

export const ADMIN_SESSION_COOKIE = "routino_admin_session";
export const ADMIN_CSRF_COOKIE = "routino_admin_csrf";
export const ADMIN_SESSION_SECONDS = 90 * 86_400;
export const ADMIN_RENEW_WINDOW_SECONDS = 30 * 86_400;
const ADMIN_ISSUER = "routino-admin";
const ADMIN_AUDIENCE = "routino-admin-panel";

const sessionSecret = (env: Env): Uint8Array =>
  new TextEncoder().encode(env.ADMIN_SESSION_SECRET);

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function adminPhoneMatches(env: Env, rawPhone: string): boolean {
  const submitted = normalizePhone(rawPhone);
  const configured = normalizePhone(env.ADMIN_PHONE);
  return !!submitted && !!configured && safeEqual(submitted, configured);
}

export function adminOtpLedgerKey(env: Env): string {
  const configured = normalizePhone(env.ADMIN_PHONE) ?? "unconfigured";
  const digest = createHmac("sha256", env.OTP_PEPPER)
    .update(`admin-otp\0${configured}`)
    .digest("hex");
  return `admin:${digest}`;
}

export async function issueAdminSession(
  env: Env,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = new Date((issuedAt + ADMIN_SESSION_SECONDS) * 1000);
  const token = await new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("admin")
    .setIssuer(ADMIN_ISSUER)
    .setAudience(ADMIN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ADMIN_SESSION_SECONDS)
    .sign(sessionSecret(env));
  return { token, expiresAt };
}

export async function verifyAdminSession(
  env: Env,
  token: string,
  now: Date,
): Promise<{ expiresAt: Date; renew: boolean }> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(env), {
      algorithms: ["HS256"],
      issuer: ADMIN_ISSUER,
      audience: ADMIN_AUDIENCE,
      currentDate: now,
    });
    if (payload.sub !== "admin" || payload.role !== "admin" || typeof payload.exp !== "number") {
      throw new Error("malformed admin session");
    }
    const expiresAt = new Date(payload.exp * 1000);
    return {
      expiresAt,
      renew: payload.exp - Math.floor(now.getTime() / 1000) < ADMIN_RENEW_WINDOW_SECONDS,
    };
  } catch {
    throw unauthorized("invalid_admin_session", "Admin session is invalid or expired");
  }
}

export function newAdminCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

const cookie = (
  name: string,
  value: string,
  expiresAt: Date,
  options: { httpOnly: boolean },
): string =>
  `${name}=${encodeURIComponent(value)}; Path=/` +
  (options.httpOnly ? "; HttpOnly" : "") +
  `; Secure; SameSite=Strict; Expires=${expiresAt.toUTCString()}`;

export const adminSessionCookie = (token: string, expiresAt: Date): string =>
  cookie(ADMIN_SESSION_COOKIE, token, expiresAt, { httpOnly: true });

export const csrfCookie = (token: string, expiresAt: Date): string =>
  cookie(ADMIN_CSRF_COOKIE, token, expiresAt, { httpOnly: false });

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function adminCsrfMatches(cookieValue: string | null, headerValue: string | undefined): boolean {
  return !!cookieValue && !!headerValue && safeEqual(cookieValue, headerValue);
}

export const clearAdminSessionCookie = (): string =>
  `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export const clearAdminCsrfCookie = (): string =>
  `${ADMIN_CSRF_COOKIE}=; Path=/; Secure; SameSite=Strict; Max-Age=0`;
