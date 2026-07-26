/**
 * Auth routes — thin edge adapter. Mirrors backend/src/routes/auth.ts exactly;
 * all OTP/token behaviour comes from the shared (tested) services.
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  clientIp,
  makeAuthenticate,
  readJson,
  requireUser,
  type AppEnv,
  type Deps,
} from "../deps.ts";
import { users } from "../shared/db/schema.ts";
import { badRequest, tooMany, unauthorized } from "../shared/lib/http-errors.ts";
import { normalizePhone } from "../shared/lib/phone.ts";
import { grantInterval, readEntitlement } from "../shared/services/entitlement.ts";
import {
  checkLoginRate,
  clearLoginFailures,
  recordLoginFailure,
} from "../shared/services/login-throttle.ts";
import { checkSendRate, createCode, verifyCode } from "../shared/services/otp.ts";
import {
  DUMMY_HASH,
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "../shared/services/password.ts";
import { issueForDevice, revokeRefresh, rotateRefresh } from "../shared/services/tokens.ts";

const TRIAL_DAYS = 7;

const requestBody = z.object({ phone: z.string().min(1).max(32) });
const verifyBody = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().min(4).max(8),
  deviceName: z.string().max(64).optional(),
});
const refreshBody = z.object({ refresh: z.string().min(16).max(256) });
const passwordLoginBody = z.object({
  identifier: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
  deviceName: z.string().max(64).optional(),
});
const setUsernameBody = z.object({ username: z.string().min(1).max(64) });
const setPasswordBody = z.object({
  newPassword: z.string().min(1).max(128),
  currentPassword: z.string().max(128).optional(),
});

export function authRoutes(deps: Deps) {
  const { db, env, sms } = deps;
  const now = () => new Date(deps.now());
  const auth = makeAuthenticate(deps);
  const r = new Hono<AppEnv>();

  /**
   * Send an OTP. Always responds the same way whether or not the number has an
   * account — a differing response would turn this into a "does this person use
   * Routino?" oracle.
   */
  r.post("/auth/otp/request", async (c) => {
    const { phone: raw } = requestBody.parse(await readJson(c));
    const phone = normalizePhone(raw);
    if (!phone) throw badRequest("invalid_phone", "Enter a valid Iranian mobile number");

    const t = now();
    const ip = clientIp(c, env);
    const verdict = await checkSendRate(db, phone, ip, t);
    if (!verdict.ok) {
      console.warn("otp rate limited", { reason: verdict.reason, phone });
      throw tooMany("Too many code requests. Try again later.", verdict.retryAfter);
    }

    const code = await createCode(db, env, phone, ip, t);
    try {
      await sms.sendOtp(phone, code);
    } catch (err) {
      // The code row stays — it counts against the rate limit either way, so a
      // provider outage can't be used to bypass throttling.
      console.error("sms send failed", { err });
      return c.json({ error: "sms_failed", message: "Could not send the code. Try again." }, 502);
    }

    return c.json({ ok: true, retryAfter: 60 });
  });

  /**
   * Verify an OTP and sign in. Creates the account on first use.
   * The 7-day trial is granted HERE, server-side.
   */
  r.post("/auth/otp/verify", async (c) => {
    const { phone: raw, code, deviceName } = verifyBody.parse(await readJson(c));
    const phone = normalizePhone(raw);
    if (!phone) throw badRequest("invalid_phone", "Enter a valid Iranian mobile number");

    const t = now();
    const result = await verifyCode(db, env, phone, code, t);
    if (!result.ok) {
      if (result.reason === "too_many")
        throw tooMany("Too many wrong attempts. Request a new code.");
      throw unauthorized("bad_code", "The code is wrong or has expired");
    }

    let [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
    let isNew = false;
    if (!user) {
      [user] = await db.insert(users).values({ phone, createdAt: t }).returning();
      isNew = true;
    }
    if (!user) throw new Error("failed to create user");
    if (user.blocked) throw unauthorized("blocked", "Account is blocked");

    if (isNew) {
      await grantInterval(db, user.id, { planId: "trial", days: TRIAL_DAYS, source: "trial" }, t);
    }

    const tokens = await issueForDevice(db, env, user.id, deviceName ?? null, t);
    const entitlement = await readEntitlement(db, user.id, t);

    return c.json({
      access: tokens.access,
      refresh: tokens.refresh,
      deviceId: tokens.deviceId,
      user: { id: user.id, phone: user.phone },
      entitlement,
      isNew,
    });
  });

  /**
   * Sign in with a password, using a phone number OR a username. No SMS. Mirrors
   * backend/src/routes/auth.ts: a username starts with a letter and a phone is
   * all digits, so `normalizePhone` succeeding is an unambiguous "this is a
   * phone"; the error is identical for missing/no-password/wrong-password and a
   * missing account still pays a hash-verify cost, so it cannot enumerate users.
   */
  r.post("/auth/password/login", async (c) => {
    const { identifier, password, deviceName } = passwordLoginBody.parse(await readJson(c));
    const t = now();
    const ip = clientIp(c, env);

    const phone = normalizePhone(identifier);
    const key = phone ?? normalizeUsername(identifier);

    const verdict = await checkLoginRate(db, ip, key, t);
    if (!verdict.ok) {
      console.warn("password login rate limited", { reason: verdict.reason });
      throw tooMany("Too many attempts. Try again later.", verdict.retryAfter);
    }

    const [user] = phone
      ? await db.select().from(users).where(eq(users.phone, phone)).limit(1)
      : await db.select().from(users).where(eq(users.username, key)).limit(1);

    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) {
      await recordLoginFailure(db, ip, key, t);
      throw unauthorized("bad_credentials", "Wrong phone/username or password");
    }
    if (user.blocked) throw unauthorized("blocked", "Account is blocked");

    await clearLoginFailures(db, key);
    const tokens = await issueForDevice(db, env, user.id, deviceName ?? null, t);
    const entitlement = await readEntitlement(db, user.id, t);

    return c.json({
      access: tokens.access,
      refresh: tokens.refresh,
      deviceId: tokens.deviceId,
      user: { id: user.id, phone: user.phone },
      entitlement,
      isNew: false,
    });
  });

  /** The current account's credential state, for the settings screen. */
  r.get("/auth/account", auth, async (c) => {
    const u = requireUser(c);
    const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (!row) throw unauthorized("unknown_user", "User no longer exists");
    return c.json({
      phone: row.phone,
      username: row.username ?? null,
      hasPassword: !!row.passwordHash,
    });
  });

  /** Sets or changes the account's username (lowercased, validated, unique). */
  r.post("/auth/username", auth, async (c) => {
    const u = requireUser(c);
    const { username } = setUsernameBody.parse(await readJson(c));
    const v = validateUsername(username);
    if (!v.ok) {
      if (v.reason === "reserved")
        throw badRequest("username_reserved", "That username is reserved");
      throw badRequest(
        "invalid_username",
        "Username must be 3–24 chars, start with a letter (a–z, 0–9, _ .)",
      );
    }

    const [taken] = await db.select().from(users).where(eq(users.username, v.value)).limit(1);
    if (taken && taken.id !== u.id)
      throw badRequest("username_taken", "That username is already taken");

    try {
      await db.update(users).set({ username: v.value }).where(eq(users.id, u.id));
    } catch {
      throw badRequest("username_taken", "That username is already taken");
    }
    return c.json({ ok: true, username: v.value });
  });

  /** Sets or changes the account's password. Changing an existing one requires
   * the current password; setting the first one does not. */
  r.post("/auth/password", auth, async (c) => {
    const u = requireUser(c);
    const { newPassword, currentPassword } = setPasswordBody.parse(await readJson(c));

    const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (!row) throw unauthorized("unknown_user", "User no longer exists");

    if (row.passwordHash) {
      if (!currentPassword || !(await verifyPassword(currentPassword, row.passwordHash))) {
        throw unauthorized("wrong_password", "Current password is wrong");
      }
    }
    if (!validatePassword(newPassword).ok) {
      throw badRequest(
        "weak_password",
        "Password must be 8+ chars with at least one letter and one digit",
      );
    }

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(users.id, u.id));
    return c.json({ ok: true });
  });

  /** Rotates the refresh token. The old one dies immediately. */
  r.post("/auth/token/refresh", async (c) => {
    const { refresh } = refreshBody.parse(await readJson(c));
    const tokens = await rotateRefresh(db, env, refresh, now());
    return c.json({ access: tokens.access, refresh: tokens.refresh, deviceId: tokens.deviceId });
  });

  /** Signs one device out. Idempotent: an unknown token is still a 200. */
  r.post("/auth/logout", async (c) => {
    const { refresh } = refreshBody.parse(await readJson(c));
    await revokeRefresh(db, refresh, now());
    return c.json({ ok: true });
  });

  return r;
}
