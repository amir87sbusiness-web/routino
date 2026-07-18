import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { users } from "../db/schema.js";
import { normalizePhone } from "../lib/phone.js";
import { badRequest, tooMany, unauthorized } from "../plugins/errors.js";
import { readEntitlement, grantInterval } from "../services/entitlement.js";
import { checkSendRate, createCode, verifyCode } from "../services/otp.js";
import { issueForDevice, revokeRefresh, rotateRefresh } from "../services/tokens.js";

const TRIAL_DAYS = 7;

const requestBody = z.object({ phone: z.string().min(1).max(32) });
const verifyBody = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().min(4).max(8),
  deviceName: z.string().max(64).optional(),
});
const refreshBody = z.object({ refresh: z.string().min(16).max(256) });

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
    const verdict = await checkSendRate(db, phone, clientIp(req), t);
    if (!verdict.ok) {
      req.log.warn({ reason: verdict.reason, phone }, "otp rate limited");
      throw tooMany("Too many code requests. Try again later.", verdict.retryAfter);
    }

    const code = await createCode(db, env, phone, clientIp(req), t);
    try {
      await sms.sendOtp(phone, code);
    } catch (err) {
      // The code row stays — it counts against the rate limit either way, so a
      // provider outage can't be used to bypass throttling.
      req.log.error({ err }, "sms send failed");
      return reply.status(502).send({ error: "sms_failed", message: "Could not send the code. Try again." });
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
      if (result.reason === "too_many") throw tooMany("Too many wrong attempts. Request a new code.");
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

    return {
      access: tokens.access,
      refresh: tokens.refresh,
      deviceId: tokens.deviceId,
      user: { id: user.id, phone: user.phone },
      entitlement,
      isNew,
    };
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
