/**
 * Access and refresh tokens.
 *
 * Access: a short-lived signed JWT, verified statelessly on every request.
 * Refresh: a long-lived OPAQUE random string, stored only as a sha256 hash on
 * the device row. Opaque rather than a JWT because it must be revocable — a JWT
 * refresh token cannot be taken away before it expires.
 *
 * Refresh rotates on every use: the old token stops working the moment a new one
 * is issued.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { Database } from "../db/client.js";
import { devices } from "../db/schema.js";
import type { Env } from "../env.js";
import { unauthorized } from "../lib/http-errors.js";

export interface AccessClaims {
  sub: string; // userId
  did: string; // deviceId — lets us trace a token back to a device
}

const secretOf = (env: Env) => new TextEncoder().encode(env.JWT_SECRET);

export async function signAccessToken(env: Env, claims: AccessClaims, now: Date): Promise<string> {
  return new SignJWT({ did: claims.did })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + env.ACCESS_TTL_SECONDS)
    .sign(secretOf(env));
}

export async function verifyAccessToken(env: Env, token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secretOf(env));
    if (!payload.sub || typeof payload.did !== "string") throw new Error("malformed");
    return { sub: payload.sub, did: payload.did };
  } catch {
    throw unauthorized("invalid_token", "Access token is invalid or expired");
  }
}

/** Refresh tokens are compared by hash, so a database leak alone cannot be
 * replayed against the API. */
export const hashToken = (raw: string): string => createHash("sha256").update(raw).digest("hex");

const newRefreshToken = (): string => randomBytes(32).toString("base64url");

export interface IssuedTokens {
  access: string;
  refresh: string;
  deviceId: string;
}

export async function issueForDevice(
  db: Database,
  env: Env,
  userId: string,
  deviceName: string | null,
  now: Date,
): Promise<IssuedTokens> {
  const refresh = newRefreshToken();
  // Plain `.returning()`: a projected `.returning({...})` doesn't typecheck
  // across the NodePg | PGlite union, and the full row costs nothing here.
  const [device] = await db
    .insert(devices)
    .values({ userId, refreshHash: hashToken(refresh), name: deviceName, lastSeenAt: now })
    .returning();

  if (!device) throw new Error("failed to create device");
  const access = await signAccessToken(env, { sub: userId, did: device.id }, now);
  return { access, refresh, deviceId: device.id };
}

/**
 * Rotates a refresh token.
 *
 * A token that doesn't match is either forged or already rotated; either way it
 * is a 401, never a silent re-issue.
 */
export async function rotateRefresh(db: Database, env: Env, raw: string, now: Date): Promise<IssuedTokens> {
  const hash = hashToken(raw);
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.refreshHash, hash), isNull(devices.revokedAt)))
    .limit(1);

  if (!device) throw unauthorized("invalid_refresh", "Refresh token is invalid or has been rotated");

  const expiresAt = new Date(device.createdAt.getTime() + env.REFRESH_TTL_DAYS * 86_400_000);
  if (expiresAt <= now) throw unauthorized("expired_refresh", "Refresh token expired");

  const next = newRefreshToken();
  await db
    .update(devices)
    .set({ refreshHash: hashToken(next), lastSeenAt: now })
    .where(eq(devices.id, device.id));

  const access = await signAccessToken(env, { sub: device.userId, did: device.id }, now);
  return { access, refresh: next, deviceId: device.id };
}

/** Revokes one device. The access token stays valid until it expires — that's
 * why ACCESS_TTL_SECONDS is minutes, not hours. */
export async function revokeRefresh(db: Database, raw: string, now: Date): Promise<void> {
  await db.update(devices).set({ revokedAt: now }).where(eq(devices.refreshHash, hashToken(raw)));
}

/** Revokes every device for a user. Call this when blocking an account. */
export async function revokeAllDevices(db: Database, userId: string, now: Date): Promise<void> {
  await db.update(devices).set({ revokedAt: now }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
}

/**
 * Revokes every device for a user EXCEPT the one making the request.
 *
 * Changing a password is how someone evicts an intruder. Refresh tokens live
 * REFRESH_TTL_DAYS (180) and rotate silently, so without this a stolen session
 * outlives the password that was supposed to kill it and the change is purely
 * cosmetic. Keeping the caller's own device is what stops the fix from signing
 * the user out of the phone they just typed the new password on.
 */
export async function revokeOtherDevices(
  db: Database,
  userId: string,
  keepDeviceId: string,
  now: Date,
): Promise<void> {
  await db
    .update(devices)
    .set({ revokedAt: now })
    .where(
      and(eq(devices.userId, userId), ne(devices.id, keepDeviceId), isNull(devices.revokedAt)),
    );
}
