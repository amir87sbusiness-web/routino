import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { users } from "../db/schema.js";
import { normalizePhone } from "../lib/phone.js";
import { requireUser } from "../plugins/auth.js";
import { badRequest, tooMany, unauthorized } from "../plugins/errors.js";
import { readEntitlement } from "../services/entitlement.js";
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
  passwordHashNeedsCaseUpgrade,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "../services/password.js";
import { SmsNotSentError } from "../providers/sms/index.js";
import { issueAccessToken } from "../services/tokens.js";
import { acquireProviderLease, releaseProviderLease } from "../services/provider-capacity.js";

const requestBody = z.object({ phone: z.string().min(1).max(32) });
const verifyBody = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().min(4).max(8),
  intent: z.enum(["signup", "password_reset"]).optional(),
  newPassword: z.string().min(1).max(128).optional(),
});
const passwordLoginBody = z.object({
  identifier: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
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
    const providerLease = await acquireProviderLease(
      db,
      "sms",
      env.SMS_PROVIDER_MAX_CONCURRENCY,
      now(),
      30_000,
    );
    if (!providerLease) {
      throw tooMany("Too many code requests. Try again later.", 1);
    }

    try {
      const slot = await claimSendSlot(db, env, phone, clientIp(req), t);
      if (!slot) {
        const verdict = await checkSendRate(db, phone, clientIp(req), t);
        req.log.warn(
          { reason: verdict.reason, phone: `***${phone.slice(-4)}` },
          "otp rate limited",
        );
        throw tooMany("Too many code requests. Try again later.", verdict.retryAfter ?? 60);
      }

      try {
        await sms.sendOtp(phone, slot.code);
      } catch (err) {
        if (err instanceof SmsNotSentError) await releaseSendSlot(db, slot.slotId);
        req.log.error({ err }, "sms send failed");
        return reply
          .status(502)
          .send({ error: "sms_failed", message: "Could not send the code. Try again." });
      }

      return { ok: true, retryAfter: 60 };
    } finally {
      await releaseProviderLease(db, "sms", providerLease.leaseId);
    }
  });

  /** Verify an OTP and sign in. Creates the account on first use. */
  app.post("/auth/otp/verify", async (req) => {
    const { phone: raw, code, intent, newPassword } = verifyBody.parse(req.body);
    const phone = normalizePhone(raw);
    if (!phone) throw badRequest("invalid_phone", "Enter a valid Iranian mobile number");

    if (intent && (!newPassword || !validatePassword(newPassword).ok)) {
      throw badRequest(
        "weak_password",
        "Password must be 8+ chars with at least one letter and one digit",
      );
    }

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
    if (intent === "password_reset" || (intent === "signup" && isNew)) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(newPassword!) })
        .where(eq(users.id, user.id));
    }

    const entitlement = await readEntitlement(db, user.id, t);
    const tokens = await issueAccessToken(env, user.id, t, {
      notAfter: entitlement.deletionAt ? new Date(entitlement.deletionAt) : null,
    });

    return {
      access: tokens.access,
      user: { id: user.id, phone: user.phone },
      entitlement,
      isNew,
    };
  });

  /** Sign in with a password, using a phone number OR a username. */
  app.post("/auth/password/login", async (req) => {
    const { identifier, password } = passwordLoginBody.parse(req.body);
    const t = now();
    const ip = clientIp(req);

    const phone = normalizePhone(identifier);
    const key = phone ?? normalizeUsername(identifier);

    const verdict = await checkLoginRate(db, env, ip, key, t);
    if (!verdict.ok) {
      req.log.warn({ reason: verdict.reason }, "password login rate limited");
      throw tooMany("Too many attempts. Try again later.", verdict.retryAfter);
    }

    const [user] = phone
      ? await db.select().from(users).where(eq(users.phone, phone)).limit(1)
      : await db.select().from(users).where(eq(users.username, key)).limit(1);

    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) {
      await recordLoginFailure(db, env, ip, key, t, { trackIdentifier: !!user });
      if (verdict.verifyOnly)
        throw tooMany("Too many attempts. Try again later.", verdict.retryAfter);
      throw unauthorized("bad_credentials", "Wrong phone/username or password");
    }
    if (passwordHashNeedsCaseUpgrade(user.passwordHash)) {
      const legacyHash = user.passwordHash;
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(password) })
        .where(and(eq(users.id, user.id), eq(users.passwordHash, legacyHash)));
    }
    await clearLoginFailures(db, env, key);
    const entitlement = await readEntitlement(db, user.id, t);
    const tokens = await issueAccessToken(env, user.id, t, {
      notAfter: entitlement.deletionAt ? new Date(entitlement.deletionAt) : null,
    });

    return {
      access: tokens.access,
      user: { id: user.id, phone: user.phone },
      entitlement,
      isNew: false,
    };
  });

  /**
   * Silent renewal for an already-authenticated device.
   *
   * The client calls this only after 45 days (or once to migrate an old 30-day
   * token). There is deliberately no refresh-token/session table: one bounded
   * entitlement read every renewal is enough to re-check account existence and
   * preserve the cleanup deadline before minting a fresh 90-day JWT.
   */
  app.post("/auth/refresh", { preHandler: app.authenticate }, async (req) => {
    const u = requireUser(req);
    const t = now();
    const entitlement = await readEntitlement(db, u.id, t);
    const tokens = await issueAccessToken(env, u.id, t, {
      notAfter: entitlement.deletionAt ? new Date(entitlement.deletionAt) : null,
    });
    return { access: tokens.access, entitlement };
  });

  /** The current account's credential state, for the settings screen. */
  app.get("/auth/account", { preHandler: app.authenticate }, async (req) => {
    const u = requireUser(req);
    const [row] = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
    if (!row) throw unauthorized("unknown_user", "User no longer exists");
    return { phone: row.phone, username: row.username ?? null, hasPassword: !!row.passwordHash };
  });

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

    let updated: (typeof users.$inferSelect)[];
    try {
      updated = await db
        .update(users)
        .set({ username: v.value })
        .where(eq(users.id, u.id))
        .returning();
    } catch {
      throw badRequest("username_taken", "That username is already taken");
    }
    if (!updated.length) throw unauthorized("unknown_user", "User no longer exists");
    return { ok: true, username: v.value };
  });

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

    return { ok: true };
  });
};
