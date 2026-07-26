/**
 * Admin API — thin Fastify adapter.
 *
 * All queries live in `services/admin.ts` (shared verbatim with the edge
 * function). Auth model: one shared secret (`ADMIN_TOKEN` env), sent as
 * `x-admin-token`, compared in constant time. Deliberately NOT tied to user
 * accounts/OTP: the panel must keep working when SMS is down — that is exactly
 * when you need it. Every mutation writes to the `grants` ledger (source='admin').
 */
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { unauthorized } from "../plugins/errors.js";
import {
  adminCreateDiscount,
  adminGrant,
  adminListDiscounts,
  adminListPayments,
  adminListUsers,
  adminOverview,
  adminSetBlocked,
  adminSetPassword,
  adminUpdateDiscount,
  adminUserDetail,
} from "../services/admin.js";

const tokenEquals = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

const grantBody = z.object({
  months: z.number().int().min(0).max(36).default(0),
  days: z.number().int().min(0).max(366).default(0),
  planId: z.string().min(1).max(32).default("admin"),
  note: z.string().max(500).optional(),
});

const blockBody = z.object({ blocked: z.boolean() });

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
  const { db, env } = app.deps;
  const now = () => new Date(app.deps.now());

  const requireAdmin = async (req: FastifyRequest) => {
    const token = req.headers["x-admin-token"];
    if (typeof token !== "string" || !tokenEquals(token, env.ADMIN_TOKEN)) {
      req.log.warn({ ip: req.ip }, "admin auth failed");
      throw unauthorized("bad_admin_token", "Invalid admin token");
    }
  };
  const opts = { preHandler: requireAdmin };

  app.get("/admin/overview", opts, async () => adminOverview(db, now()));

  app.get("/admin/users", opts, async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: string };
    return { users: await adminListUsers(db, { q, limit: Number(limit) || undefined }, now()) };
  });

  app.get("/admin/users/:id", opts, async (req) => {
    const { id } = req.params as { id: string };
    return adminUserDetail(db, id, now());
  });

  app.post("/admin/users/:id/block", opts, async (req) => {
    const { id } = req.params as { id: string };
    const { blocked } = blockBody.parse(req.body);
    const res = await adminSetBlocked(db, id, blocked, now());
    req.log.info({ userId: id, blocked }, "admin block toggle");
    return res;
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
    req.log.info({ phone: res.phone, created: res.created }, "admin set password");
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
