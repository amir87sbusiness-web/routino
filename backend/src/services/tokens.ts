/** Stateless access tokens. There is no server-side session or refresh token. */
import { SignJWT, jwtVerify } from "jose";
import type { Env } from "../env.js";
import { unauthorized } from "../lib/http-errors.js";

export interface AccessClaims {
  sub: string;
}

const secretOf = (env: Env) => new TextEncoder().encode(env.JWT_SECRET);

export async function signAccessToken(
  env: Env,
  claims: AccessClaims,
  now: Date,
  options: { notAfter?: Date | null } = {},
): Promise<string> {
  const normalExpiry = Math.floor(now.getTime() / 1000) + env.ACCESS_TTL_SECONDS;
  const cappedExpiry = options.notAfter
    ? Math.min(normalExpiry, Math.floor(options.notAfter.getTime() / 1000))
    : normalExpiry;
  return new SignJWT()
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(cappedExpiry)
    .sign(secretOf(env));
}

export async function issueAccessToken(
  env: Env,
  userId: string,
  now: Date,
  options: { notAfter?: Date | null } = {},
): Promise<{ access: string }> {
  return { access: await signAccessToken(env, { sub: userId }, now, options) };
}

export async function verifyAccessToken(env: Env, token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secretOf(env));
    if (!payload.sub) throw new Error("malformed");
    return { sub: payload.sub };
  } catch {
    throw unauthorized("invalid_token", "Access token is invalid or expired");
  }
}
