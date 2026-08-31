/**
 * Admin API — thin Fastify adapter.
 *
 * All queries live in `services/admin.ts` (shared verbatim with the edge
 * function). The owner requests an admin-namespaced OTP and receives a signed,
 * HttpOnly cookie; no browser-stored shared secret exists.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { normalizePhone } from "../lib/phone.js";
import { forbidden, tooMany, unauthorized } from "../plugins/errors.js";
import { SmsNotSentError } from "../providers/sms/index.js";
import {
  ADMIN_CSRF_COOKIE,
  ADMIN_SESSION_COOKIE,
  adminCsrfMatches,
  adminOtpLedgerKey,
  adminPhoneMatches,
  adminSessionCookie,
  clearAdminCsrfCookie,
  clearAdminSessionCookie,
  csrfCookie,
  issueAdminSession,
  newAdminCsrfToken,
  readCookie,
  verifyAdminSession,
} from "../services/admin-auth.js";
import { claimAdminOtpRequest } from "../services/login-throttle.js";
import { claimSendSlot, releaseSendSlot, verifyCode } from "../services/otp.js";
import {
  adminCreateDiscount,
  adminGrant,
  adminListDiscounts,
  adminListPayments,
  adminListUsers,
  adminOverview,
  adminSetPassword,
  adminUpdateDiscount,
  adminUserDetail,
} from "../services/admin.js";

const adminOtpRequestBody = z.object({ phone: z.string().min(1).max(32) });
const adminOtpVerifyBody = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().min(4).max(8),
});

// Negative values are allowed on purpose, and this is the ONLY way to take
// access back. A refund or a chargeback happens entirely at the gateway — no
// callback reaches this server and nothing polls for one — so a user who gets
// their money back keeps a working subscription until somebody corrects it by
// hand. Without a negative grant the only remedy was blocking the whole
// account, which is far too blunt for "they refunded one month of three".
//
// `grantInterval` handles the arithmetic correctly either way: Postgres'
// `make_interval` takes negative months/days, and the surrounding
// `greatest(expires_at, now) + interval` means subtracting walks the expiry
// backwards from wherever it actually is. Every adjustment still lands in the
// append-only `grants` ledger with its note, so "why did this shrink" stays
// answerable.
const grantBody = z.object({
  months: z.number().int().min(-36).max(36).default(0),
  days: z.number().int().min(-366).max(366).default(0),
  planId: z.string().min(1).max(32).default("admin"),
  note: z.string().max(500).optional(),
});

const setPasswordBody = z.object({
  phone: z.string().min(1).max(32),
  password: z.string().min(1).max(128),
});

const discountCreateBody = z.object({
  code: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, "letters/digits/dash only"),
  percent: z.number().int().min(1).max(100),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  expiresAt: z.number().int().positive().nullable().optional(), // epoch ms
  phone: z.string().max(20).nullable().optional(),
});

const discountUpdateBody = z.object({
  active: z.boolean().optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  expiresAt: z.number().int().positive().nullable().optional(),
});

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, sms } = app.deps;
  const now = () => new Date(app.deps.now());

  const setSessionCookies = async (reply: FastifyReply, t: Date) => {
    const session = await issueAdminSession(env, t);
    const csrf = newAdminCsrfToken();
    void reply.header("set-cookie", [
      adminSessionCookie(session.token, session.expiresAt),
      csrfCookie(csrf, session.expiresAt),
    ]);
  };

  const clearCookies = (reply: FastifyReply) => {
    void reply.header("set-cookie", [clearAdminSessionCookie(), clearAdminCsrfCookie()]);
  };

  const requireSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const t = now();
    const token = readCookie(req.headers.cookie, ADMIN_SESSION_COOKIE);
    if (!token) throw unauthorized("invalid_admin_session", "Admin session is required");
    try {
      const session = await verifyAdminSession(env, token, t);
      if (session.renew) await setSessionCookies(reply, t);
    } catch (error) {
      clearCookies(reply);
      throw error;
    }
  };

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    await requireSession(req, reply);
    if (req.method === "POST") {
      const csrf = readCookie(req.headers.cookie, ADMIN_CSRF_COOKIE);
      const header = req.headers["x-admin-csrf"];
      if (!adminCsrfMatches(csrf, typeof header === "string" ? header : undefined)) {
        throw forbidden("bad_admin_csrf", "Admin CSRF token is invalid");
      }
    }
  };
  const opts = { preHandler: requireAdmin };

  app.post("/admin/auth/otp/request", async (req, reply) => {
    const { phone } = adminOtpRequestBody.parse(req.body);
    const t = now();
    const verdict = await claimAdminOtpRequest(db, env, req.ip ?? null, t);
    if (!verdict.ok) {
      throw tooMany("Too many admin code requests. Try again later.", verdict.retryAfter);
    }

    if (adminPhoneMatches(env, phone)) {
      const ledgerKey = adminOtpLedgerKey(env);
      const slot = await claimSendSlot(db, env, ledgerKey, req.ip ?? null, t);
      if (slot) {
        try {
          await sms.sendOtp(normalizePhone(env.ADMIN_PHONE)!, slot.code);
        } catch (error) {
          if (error instanceof SmsNotSentError) await releaseSendSlot(db, slot.slotId);
          req.log.error({ error }, "admin otp send failed");
        }
      }
    }
    return reply.status(202).send({ accepted: true });
  });

  app.post("/admin/auth/otp/verify", async (req, reply) => {
    const { phone, code } = adminOtpVerifyBody.parse(req.body);
    if (!adminPhoneMatches(env, phone)) {
      throw unauthorized("bad_admin_code", "The code is wrong or has expired");
    }
    const result = await verifyCode(db, env, adminOtpLedgerKey(env), code, now());
    if (!result.ok) {
      if (result.reason === "too_many")
        throw tooMany("Too many wrong attempts. Request a new code.");
      throw unauthorized("bad_admin_code", "The code is wrong or has expired");
    }
    await setSessionCookies(reply, now());
    return { authenticated: true };
  });

  app.get("/admin/auth/session", async (req, reply) => {
    await requireSession(req, reply);
    return { authenticated: true };
  });

  app.post("/admin/auth/logout", async (_req, reply) => {
    clearCookies(reply);
    return reply.status(204).send();
  });

  app.get("/admin/overview", opts, async () => adminOverview(db, now()));

  app.get("/admin/users", opts, async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: string };
    return { users: await adminListUsers(db, { q, limit: Number(limit) || undefined }, now()) };
  });

  app.get("/admin/users/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    return adminUserDetail(db, id, now());
  });

  app.post("/admin/users/:id/grant", opts, async (req) => {
    const { id } = req.params as { id: string };
    const body = grantBody.parse(req.body);
    const res = await adminGrant(db, id, body, now());
    req.log.info({ userId: id, months: body.months, days: body.days }, "admin grant");
    return res;
  });

  // Set/reset a password by phone, creating the account if needed. `set-password`
  // is a fixed path, so it never collides with the `/admin/users/:id` params.
  app.post("/admin/users/set-password", opts, async (req) => {
    const body = setPasswordBody.parse(req.body);
    const res = await adminSetPassword(db, body, now());
    req.log.info({ created: res.created }, "admin set password");
    return res;
  });

  app.get("/admin/payments", opts, async (req) => {
    const { status, limit } = req.query as { status?: string; limit?: string };
    return { payments: await adminListPayments(db, { status, limit: Number(limit) || undefined }) };
  });

  app.get("/admin/discounts", opts, async () => ({ discounts: await adminListDiscounts(db) }));

  app.post("/admin/discounts", opts, async (req) =>
    adminCreateDiscount(db, discountCreateBody.parse(req.body)),
  );

  app.post("/admin/discounts/:code", opts, async (req) => {
    const { code } = req.params as { code: string };
    return adminUpdateDiscount(db, code, discountUpdateBody.parse(req.body));
  });
};
