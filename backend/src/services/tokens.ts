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
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { Database } from "../db/client.js";
import { deviceSecurityEvents, devices, users } from "../db/schema.js";
import type { Env } from "../env.js";
import { locked, unauthorized } from "../lib/http-errors.js";

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

export interface DeviceDescriptor {
  installationKey: string;
  name: string;
  platform: "web" | "pwa" | "android" | "ios";
  browser?: string;
  os?: string;
}

export const DEVICE_SWITCH_WINDOW_MS = 15 * 86_400_000;
export const MAX_SWITCHES_PER_WINDOW = 3;
export const SUPPORT_ID = "routino_support";

export async function issueForDevice(
  db: Database,
  env: Env,
  userId: string,
  descriptor: DeviceDescriptor,
  now: Date,
): Promise<IssuedTokens> {
  const installationKeyHash = hashToken(descriptor.installationKey);
  const outcome = await db.transaction(async (tx) => {
    // Serialise all device decisions for this account. Without this lock, two
    // simultaneous logins can both observe a free slot and both enter it.
    await tx.execute(sql`select id from users where id = ${userId} for update`);
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw unauthorized("unknown_user", "User no longer exists");
    if (user.securityLockedAt) return { locked: true as const };

    const [existing] = await tx
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), eq(devices.installationKeyHash, installationKeyHash)))
      .limit(1);

    const active = await tx
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
      .orderBy(sql`${devices.lastSeenAt} asc nulls first`, asc(devices.createdAt));

    const alreadyActive = existing && !existing.revokedAt;
    let replacedDeviceId: string | null = null;
    if (!alreadyActive && active.length >= user.maxActiveDevices) {
      const rollingStart = new Date(now.getTime() - DEVICE_SWITCH_WINDOW_MS);
      const since =
        user.deviceSwitchResetAt && user.deviceSwitchResetAt > rollingStart
          ? user.deviceSwitchResetAt
          : rollingStart;
      const recent = await tx
        .select({ id: deviceSecurityEvents.id })
        .from(deviceSecurityEvents)
        .where(
          and(
            eq(deviceSecurityEvents.userId, userId),
            eq(deviceSecurityEvents.kind, "replacement"),
            gt(deviceSecurityEvents.createdAt, since),
          ),
        )
        .limit(MAX_SWITCHES_PER_WINDOW);

      if (recent.length >= MAX_SWITCHES_PER_WINDOW) {
        await tx
          .update(users)
          .set({
            securityLockedAt: now,
            securityLockReason: "device_switch_limit",
          })
          .where(eq(users.id, userId));
        await tx
          .update(devices)
          .set({
            revokedAt: now,
            revocationReason: "security_lock",
          })
          .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
        await tx.insert(deviceSecurityEvents).values({
          userId,
          kind: "security_lock",
          createdAt: now,
        });
        return { locked: true as const };
      }

      const stale = active[0];
      if (stale) {
        replacedDeviceId = stale.id;
        await tx
          .update(devices)
          .set({ revokedAt: now, revocationReason: "replaced" })
          .where(eq(devices.id, stale.id));
      }
    }

    const refresh = newRefreshToken();
    const patch = {
      refreshHash: hashToken(refresh),
      name: descriptor.name,
      platform: descriptor.platform,
      browser: descriptor.browser ?? null,
      os: descriptor.os ?? null,
      lastSeenAt: now,
      revokedAt: null,
      revocationReason: null,
    };
    const [device] = existing
      ? await tx.update(devices).set(patch).where(eq(devices.id, existing.id)).returning()
      : await tx
          .insert(devices)
          .values({ userId, installationKeyHash, createdAt: now, ...patch })
          .returning();
    if (!device) throw new Error("failed to create device");

    if (replacedDeviceId) {
      await tx.insert(deviceSecurityEvents).values({
        userId,
        deviceId: device.id,
        replacedDeviceId,
        kind: "replacement",
        createdAt: now,
      });
    }
    return { locked: false as const, refresh, deviceId: device.id };
  });

  if (outcome.locked) {
    throw locked(
      "device_security_locked",
      "For account security, sign-in is temporarily locked. Contact support.",
      { support: SUPPORT_ID },
    );
  }
  const access = await signAccessToken(env, { sub: userId, did: outcome.deviceId }, now);
  return { access, refresh: outcome.refresh, deviceId: outcome.deviceId };
}

/**
 * Rotates a refresh token.
 *
 * A token that doesn't match is either forged or already rotated; either way it
 * is a 401, never a silent re-issue.
 */
export async function rotateRefresh(
  db: Database,
  env: Env,
  raw: string,
  now: Date,
): Promise<IssuedTokens> {
  const hash = hashToken(raw);
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.refreshHash, hash), isNull(devices.revokedAt)))
    .limit(1);

  if (!device)
    throw unauthorized("invalid_refresh", "Refresh token is invalid or has been rotated");

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

/** Revokes one device. Protected routes re-read this device row, so even an
 * otherwise-valid access token is rejected on the next request. */
export async function revokeRefresh(db: Database, raw: string, now: Date): Promise<void> {
  await db
    .update(devices)
    .set({ revokedAt: now })
    .where(eq(devices.refreshHash, hashToken(raw)));
}

/** Revokes every device for a user. Call this when blocking an account. */
export async function revokeAllDevices(db: Database, userId: string, now: Date): Promise<void> {
  await db
    .update(devices)
    .set({ revokedAt: now })
    .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
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
  // Refuse rather than run. Drizzle compiles `ne(col, undefined)` to `col <> NULL`,
  // which is UNKNOWN for every row, so a falsy id would revoke NOTHING and leave
  // the intruder signed in — silently, with no error and no log. That is the one
  // failure mode a security control must not have, so fail loudly instead.
  if (!keepDeviceId) throw new Error("revokeOtherDevices requires a device id");
  await db
    .update(devices)
    .set({ revokedAt: now })
    .where(
      and(eq(devices.userId, userId), ne(devices.id, keepDeviceId), isNull(devices.revokedAt)),
    );
}

/** How many devices one account may keep signed in at once.
 *
 * Two, not one: the person who PAID typically has a phone and a laptop browser,
 * and at one they would evict themselves daily. A family of five finds two just
 * as unusable as one, so the extra slot costs nothing in sharing pressure. */
export const MAX_ACTIVE_DEVICES = 1;

/**
 * Keeps the `max` most recently used devices signed in and revokes the rest.
 *
 * Runs on SIGN-IN ONLY, never in the request path — one indexed select plus at
 * most one update, against a row that is created about once per
 * REFRESH_TTL_DAYS. Nothing else needs a new check: `rotateRefresh` already
 * refuses a revoked row, so an evicted device dies at its next refresh without
 * costing every other request a lookup.
 *
 * Evicts by `last_seen_at`, not `created_at`. The oldest-CREATED device is
 * routinely the owner's daily phone — evicting that instead of the tablet they
 * last opened in March is the one outcome that would make this feel broken to
 * the person paying for it.
 *
 * Returns how many devices were evicted.
 */
export async function enforceDeviceLimit(
  db: Database,
  userId: string,
  keepDeviceId: string,
  now: Date,
  max: number = MAX_ACTIVE_DEVICES,
): Promise<number> {
  // Same reasoning as revokeOtherDevices: Drizzle compiles `ne(col, undefined)`
  // to `col <> NULL`, which is UNKNOWN for every row — a falsy id would evict
  // NOTHING, silently, with no error and no log. Fail loudly instead.
  if (!keepDeviceId) throw new Error("enforceDeviceLimit requires a device id");

  const others = await db
    .select()
    .from(devices)
    .where(and(eq(devices.userId, userId), ne(devices.id, keepDeviceId), isNull(devices.revokedAt)))
    // NULLS LAST is spelled out because Postgres orders nulls FIRST under DESC,
    // which would rank a never-seen device above the one the user lives in and
    // evict the wrong device. `issueForDevice` always stamps `lastSeenAt`, so
    // this is belt-and-braces for rows written before it did.
    .orderBy(sql`${devices.lastSeenAt} desc nulls last`, desc(devices.createdAt));

  // The device that just signed in always survives and claims one of the slots,
  // so only `max - 1` of the others may stay.
  const doomed = others.slice(Math.max(max - 1, 0));
  if (doomed.length === 0) return 0;

  await db
    .update(devices)
    .set({ revokedAt: now })
    .where(
      inArray(
        devices.id,
        doomed.map((d) => d.id),
      ),
    );
  return doomed.length;
}
