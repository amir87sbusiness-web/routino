/**
 * Auth routes — thin edge adapter. Mirrors backend/src/routes/auth.ts exactly;
 * all OTP/token behaviour comes from the shared (tested) services.
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { clientIp, readJson, type AppEnv, type Deps } from "../deps.ts";
import { users } from "../shared/db/schema.ts";
import { badRequest, tooMany, unauthorized } from "../shared/lib/http-errors.ts";
import { normalizePhone } from "../shared/lib/phone.ts";
import { grantInterval, readEntitlement } from "../shared/services/entitlement.ts";
import { checkSendRate, createCode, verifyCode } from "../shared/services/otp.ts";
import { issueForDevice, revokeRefresh, rotateRefresh } from "../shared/services/tokens.ts";

const TRIAL_DAYS = 7;

const requestBody = z.object({ phone: z.string().min(1).max(32) });
const verifyBody = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().min(4).max(8),
  deviceName: z.string().max(64).optional(),
});
const refreshBody = z.object({ refresh: z.string().min(16).max(256) });

export function authRoutes(deps: Deps) {
  const { db, env, sms } = deps;
  const now = () => new Date(deps.now());
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
