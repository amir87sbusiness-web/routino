import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { users } from "../db/schema.js";
import { normalizePhone } from "../lib/phone.js";
import { requireUser } from "../plugins/auth.js";
import { badRequest, tooMany, unauthorized } from "../plugins/errors.js";
import { readEntitlement, grantInterval } from "../services/entitlement.js";
import {
  checkLoginRate,
  clearLoginFailures,
  recordLoginFailure,
} from "../services/login-throttle.js";
import { checkSendRate, claimSendSlot, releaseSendSlot, verifyCode } from "../services/otp.js";
import {
  DUMMY_HASH,
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "../services/password.js";
import { SmsNotSentError } from "../providers/sms/index.js";
import {
  enforceDeviceLimit,
  issueForDevice,
  revokeOtherDevices,
  revokeRefresh,
  rotateRefresh,
} from "../services/tokens.js";

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

/** `req.ip` already resolves x-forwarded-for when (and ONLY when) TRUST_PROXY
 * is on — reading the header directly here would let any client spoof its IP
 * past the per-IP OTP limits with a one-line curl flag. */
function clientIp(req: FastifyRequest): string | null {
  return req.ip ?? null;
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, sms } = app.deps;
  const now = () => new Date(app.deps.now());

  /**
   * Send an OTP.
   *
   * Always responds the same way whether or not the number has an account —
   * a differing response would turn this into a "does this person use Routino?"
   * oracle.
   */
  app.post("/auth/otp/request", async (req, reply) => {
    const { phone: raw } = requestBody.parse(req.body);
    const phone = normalizePhone(raw);
    if (!phone) throw badRequest("invalid_phone", "Enter a valid Iranian mobile number");

    const t = now();
    // The slot and the code are claimed together, in ONE statement — see
    // `claimSendSlot`. `checkSendRate` still runs, but only to explain WHICH
    // limit was hit; it no longer enforces them, because a check followed by a
    // separate insert let simultaneous requests for one phone each count zero
    // rows and each send a message. Every one of those is real money.
    const slot = await claimSendSlot(db, env, phone, clientIp(req), t);
    if (!slot) {
      const verdict = await checkSendRate(db, phone, clientIp(req), t);
      // Last 4 digits only. These logs land in a third-party pipeline with its
      // own retention and access rules; a full subscriber list does not belong
      // there just to explain a rate-limit hit.
      req.log.warn({ reason: verdict.reason, phone: `***${phone.slice(-4)}` }, "otp rate limited");
      throw tooMany("Too many code requests. Try again later.", verdict.retryAfter ?? 60);
    }

    try {
      await sms.sendOtp(phone, slot.code);
    } catch (err) {
      // Give the slot back only when the provider is CERTAIN nothing was sent
      // (bad template, empty account, rejected receptor). That send cost
      // nothing, so charging the user's per-hour allowance for it would lock
      // them out for an hour over our misconfiguration — and from their side it
      // is indistinguishable from "the SMS just doesn't arrive sometimes".
      // A timeout or a 5xx is deliberately NOT refunded: the message may
      // genuinely have gone out, and refunding an ambiguous failure is how the
      // rate limit stops protecting the bill.
      if (err instanceof SmsNotSentError) await releaseSendSlot(db, slot.slotId);
      // The code row stays — it counts against the rate limit either way, so a
      // provider outage can't be used to bypass throttling.
      req.log.error({ err }, "sms send failed");
      return reply
        .status(502)
        .send({ error: "sms_failed", message: "Could not send the code. Try again." });
    }

    return { ok: true, retryAfter: 60 };
  });

  /**
   * Verify an OTP and sign in. Creates the account on first use.
   *
   * The 7-day trial is granted HERE, server-side. It used to be written by the
   * client, where anyone could re-grant it forever.
   */
  app.post("/auth/otp/verify", async (req) => {
    const { phone: raw, code, deviceName } = verifyBody.parse(req.body);
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
    await enforceDeviceLimit(db, user.id, tokens.deviceId, t);
    const entitlement = await readEntitlement(db, user.id, t);

    return {
      access: tokens.access,
      refresh: tokens.refresh,
      deviceId: tokens.deviceId,
      user: { id: user.id, phone: user.phone },
      entitlement,
      isNew,
    };
  });

  /**
   * Sign in with a password, using a phone number OR a username as the
   * identifier. No SMS — this is the everyday path once a password is set.
   *
   * A username always starts with a letter and a phone is all digits, so
   * `normalizePhone` succeeding is an unambiguous "this is a phone". The error is
   * identical for "no such account", "no password set" and "wrong password", and
   * a missing account still pays the cost of a hash verify (DUMMY_HASH) — none of
   * the three is distinguishable, so the endpoint can't be used to discover who
   * has an account.
   */
  app.post("/auth/password/login", async (req) => {
    const { identifier, password, deviceName } = passwordLoginBody.parse(req.body);
    const t = now();
    const ip = clientIp(req);

    const phone = normalizePhone(identifier);
    const key = phone ?? normalizeUsername(identifier);

    const verdict = await checkLoginRate(db, ip, key, t);
    if (!verdict.ok) {
      req.log.warn({ reason: verdict.reason }, "password login rate limited");
      throw tooMany("Too many attempts. Try again later.", verdict.retryAfter);
    }

    const [user] = phone
      ? await db.select().from(users).where(eq(users.phone, phone)).limit(1)
      : await db.select().from(users).where(eq(users.username, key)).limit(1);

    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) {
      await recordLoginFailure(db, ip, key, t);
      // Past the soft limit the answer becomes "too many attempts" instead of
      // "wrong password" — but only for a wrong one. A correct password still
      // gets through below, so an attacker cannot lock the real owner out.
      if (verdict.verifyOnly)
        throw tooMany("Too many attempts. Try again later.", verdict.retryAfter);
      throw unauthorized("bad_credentials", "Wrong phone/username or password");
    }
    // Only tell a caller who PROVED they own the account that it is blocked.
    if (user.blocked) throw unauthorized("blocked", "Account is blocked");

    await clearLoginFailures(db, key);
    const tokens = await issueForDevice(db, env, user.id, deviceName ?? null, t);
    await enforceDeviceLimit(db, user.id, tokens.deviceId, t);
    const entitlement = await readEntitlement(db, user.id, t);

    return {
      access: tokens.access,
      refresh: tokens.refresh,
      deviceId: tokens.deviceId,
      user: { id: user.id, phone: user.phone },
      entitlement,
      isNew: false,
    };
  });

  /** The current account's credential state, for the settings screen. */
  app.get("/auth/account", { preHandler: app.authenticate }, async (req) => {
    const u = requireUser(req);
    const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (!row) throw unauthorized("unknown_user", "User no longer exists");
    return { phone: row.phone, username: row.username ?? null, hasPassword: !!row.passwordHash };
  });

  /** Sets or changes the account's username. Lowercased and validated; the
   * unique index is the real guard against a race between two callers. */
  app.post("/auth/username", { preHandler: app.authenticate }, async (req) => {
    const u = requireUser(req);
    const { username } = setUsernameBody.parse(req.body);
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
      // Unique-index violation from a concurrent claim of the same name.
      throw badRequest("username_taken", "That username is already taken");
    }
    return { ok: true, username: v.value };
  });

  /** Sets or changes the account's password. Changing an existing one requires
   * the current password; setting the first one does not (the bearer token is
   * proof enough). */
  app.post("/auth/password", { preHandler: app.authenticate }, async (req) => {
    const u = requireUser(req);
    const { newPassword, currentPassword } = setPasswordBody.parse(req.body);

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

    // Changing a password is how a user evicts someone who got in. Refresh
    // tokens live 180 days and rotate silently, so leaving other devices signed
    // in would make the change cosmetic — the intruder simply keeps refreshing.
    // The caller's own device is kept so they aren't signed out of the phone
    // they just set the password on.
    await revokeOtherDevices(db, u.id, u.deviceId, now());
    return { ok: true };
  });

  /** Rotates the refresh token. The old one dies immediately. */
  app.post("/auth/token/refresh", async (req) => {
    const { refresh } = refreshBody.parse(req.body);
    const tokens = await rotateRefresh(db, env, refresh, now());
    return { access: tokens.access, refresh: tokens.refresh, deviceId: tokens.deviceId };
  });

  /** Signs one device out. Idempotent: an unknown token is still a 200, because
   * the caller's intent ("I want to be signed out") is satisfied either way. */
  app.post("/auth/logout", async (req) => {
    const { refresh } = refreshBody.parse(req.body);
    await revokeRefresh(db, refresh, now());
    return { ok: true };
  });
};
