/**
 * Admin API — thin edge adapter. All queries live in shared/services/admin.ts
 * (byte-identical to the backend copy). Auth: `ADMIN_TOKEN` via `x-admin-token`,
 * constant-time compared.
 */
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { z } from "zod";
import { readJson, type AppEnv, type Deps } from "../deps.ts";
import { unauthorized } from "../shared/lib/http-errors.ts";
import {
  adminCreateDiscount,
  adminGrant,
  adminListDiscounts,
  adminListPayments,
  adminListUsers,
  adminOverview,
  adminSetBlocked,
  adminUpdateDiscount,
  adminUserDetail,
} from "../shared/services/admin.ts";

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

export function adminRoutes(deps: Deps) {
  const { db, env } = deps;
  const now = () => new Date(deps.now());

  const requireAdmin = async (c: Context<AppEnv>, next: Next) => {
    const token = c.req.header("x-admin-token");
    if (typeof token !== "string" || !tokenEquals(token, env.ADMIN_TOKEN)) {
      console.warn("admin auth failed");
      throw unauthorized("bad_admin_token", "Invalid admin token");
    }
    await next();
  };

  const r = new Hono<AppEnv>();
  r.use("/admin/*", requireAdmin);

  r.get("/admin/overview", async (c) => c.json(await adminOverview(db, now())));

  r.get("/admin/users", async (c) => {
    const users = await adminListUsers(
      db,
      { q: c.req.query("q"), limit: Number(c.req.query("limit")) || undefined },
      now(),
    );
    return c.json({ users });
  });

  r.get("/admin/users/:id", async (c) =>
    c.json(await adminUserDetail(db, c.req.param("id"), now())),
  );

  r.post("/admin/users/:id/block", async (c) => {
    const { blocked } = blockBody.parse(await readJson(c));
    const res = await adminSetBlocked(db, c.req.param("id"), blocked, now());
    console.info("admin block toggle", { userId: c.req.param("id"), blocked });
    return c.json(res);
  });

  r.post("/admin/users/:id/grant", async (c) => {
    const body = grantBody.parse(await readJson(c));
    const res = await adminGrant(db, c.req.param("id"), body, now());
    console.info("admin grant", {
      userId: c.req.param("id"),
      months: body.months,
      days: body.days,
    });
    return c.json(res);
  });

  r.get("/admin/payments", async (c) => {
    const payments = await adminListPayments(db, {
      status: c.req.query("status"),
      limit: Number(c.req.query("limit")) || undefined,
    });
    return c.json({ payments });
  });

  r.get("/admin/discounts", async (c) => c.json({ discounts: await adminListDiscounts(db) }));

  r.post("/admin/discounts", async (c) =>
    c.json(await adminCreateDiscount(db, discountCreateBody.parse(await readJson(c)))),
  );

  r.post("/admin/discounts/:code", async (c) =>
    c.json(
      await adminUpdateDiscount(
        db,
        c.req.param("code"),
        discountUpdateBody.parse(await readJson(c)),
      ),
    ),
  );

  return r;
}
