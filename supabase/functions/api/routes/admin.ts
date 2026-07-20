/**
 * Admin API — thin edge adapter mirroring backend/src/routes/admin.ts.
 *
 * Auth model: one shared secret (`ADMIN_TOKEN` env), sent as `x-admin-token`,
 * compared in constant time. Deliberately NOT tied to user accounts/OTP: the
 * panel must keep working when SMS is down — that is exactly when you need it.
 * Every mutation writes to the `grants` ledger (source='admin').
 */
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, ilike, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { z } from "zod";
import { readJson, type AppEnv, type Deps } from "../deps.ts";
import {
  discounts,
  entitlements,
  devices,
  grants,
  otpCodes,
  payments,
  users,
} from "../shared/db/schema.ts";
import { badRequest, notFound, unauthorized } from "../shared/lib/http-errors.ts";
import { toAsciiDigits } from "../shared/lib/phone.ts";
import { grantInterval, listGrants, readEntitlement } from "../shared/services/entitlement.ts";
import { revokeAllDevices } from "../shared/services/tokens.ts";

const tokenEquals = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  r.get("/admin/overview", async (c) => {
    const t = now();
    const dayAgo = new Date(t.getTime() - 86_400_000);

    const [totalUsers] = await db.select({ n: count() }).from(users);
    const [newUsers] = await db
      .select({ n: count() })
      .from(users)
      .where(gt(users.createdAt, dayAgo));
    const [activeSubs] = await db
      .select({ n: count() })
      .from(entitlements)
      .where(gt(entitlements.expiresAt, t));
    const [paid] = await db
      .select({ n: count(), revenue: sql<string>`coalesce(sum(${payments.amountToman}), 0)` })
      .from(payments)
      .where(eq(payments.status, "paid"));
    const [paidToday] = await db
      .select({ n: count(), revenue: sql<string>`coalesce(sum(${payments.amountToman}), 0)` })
      .from(payments)
      .where(and(eq(payments.status, "paid"), gt(payments.createdAt, dayAgo)));
    const [otpToday] = await db
      .select({ n: count() })
      .from(otpCodes)
      .where(gt(otpCodes.createdAt, dayAgo));

    return c.json({
      users: { total: totalUsers?.n ?? 0, last24h: newUsers?.n ?? 0 },
      activeSubscriptions: activeSubs?.n ?? 0,
      payments: {
        paidTotal: paid?.n ?? 0,
        revenueToman: Number(paid?.revenue ?? 0),
        paidLast24h: paidToday?.n ?? 0,
        revenueTomanLast24h: Number(paidToday?.revenue ?? 0),
      },
      otpSentLast24h: otpToday?.n ?? 0,
      serverTime: t.toISOString(),
    });
  });

  r.get("/admin/users", async (c) => {
    const q = c.req.query("q");
    const n = Math.min(Number(c.req.query("limit")) || 50, 200);

    const base = db
      .select({
        id: users.id,
        phone: users.phone,
        blocked: users.blocked,
        createdAt: users.createdAt,
        planId: entitlements.planId,
        expiresAt: entitlements.expiresAt,
      })
      .from(users)
      .leftJoin(entitlements, eq(entitlements.userId, users.id))
      .orderBy(desc(users.createdAt))
      .limit(n);

    // Humans type `0912…`; the canonical stored form is `98912…`. Dropping the
    // leading zero makes the obvious search work.
    let digits = q ? toAsciiDigits(q).replace(/\D/g, "") : "";
    if (digits.startsWith("0")) digits = digits.slice(1);
    const rows = digits ? await base.where(ilike(users.phone, `%${digits}%`)) : await base;
    const t = now();
    return c.json({
      users: rows.map((row) => ({
        ...row,
        subscriptionActive: !!row.expiresAt && row.expiresAt > t,
      })),
    });
  });

  r.get("/admin/users/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed user id");
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw notFound("unknown_user", "No such user");

    const t = now();
    const [userDevices, userPayments, userGrants, entitlement] = await Promise.all([
      db.select().from(devices).where(eq(devices.userId, id)).orderBy(desc(devices.createdAt)),
      db.select().from(payments).where(eq(payments.userId, id)).orderBy(desc(payments.createdAt)),
      listGrants(db, id),
      readEntitlement(db, id, t),
    ]);

    return c.json({
      user: { id: user.id, phone: user.phone, blocked: user.blocked, createdAt: user.createdAt },
      entitlement,
      devices: userDevices.map((d) => ({
        id: d.id,
        name: d.name,
        lastSeenAt: d.lastSeenAt,
        revokedAt: d.revokedAt,
        createdAt: d.createdAt,
      })),
      payments: userPayments,
      grants: userGrants,
    });
  });

  r.post("/admin/users/:id/block", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed user id");
    const { blocked } = blockBody.parse(await readJson(c));
    const t = now();

    const [user] = await db.update(users).set({ blocked }).where(eq(users.id, id)).returning();
    if (!user) throw notFound("unknown_user", "No such user");
    // Blocking must also kill sessions, or the user keeps access until their
    // refresh token dies of old age.
    if (blocked) await revokeAllDevices(db, id, t);
    console.info("admin block toggle", { userId: id, blocked });
    return c.json({ ok: true, blocked: user.blocked });
  });

  r.post("/admin/users/:id/grant", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed user id");
    const body = grantBody.parse(await readJson(c));
    if (body.months === 0 && body.days === 0)
      throw badRequest("empty_grant", "months or days required");

    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw notFound("unknown_user", "No such user");

    const entitlement = await grantInterval(
      db,
      id,
      {
        planId: body.planId,
        months: body.months,
        days: body.days,
        source: "admin",
        note: body.note ?? null,
      },
      now(),
    );
    console.info("admin grant", { userId: id, months: body.months, days: body.days });
    return c.json({ ok: true, entitlement });
  });

  r.get("/admin/payments", async (c) => {
    const status = c.req.query("status");
    const n = Math.min(Number(c.req.query("limit")) || 50, 200);

    const base = db
      .select({
        id: payments.id,
        phone: users.phone,
        userId: payments.userId,
        planId: payments.planId,
        amountToman: payments.amountToman,
        discountCode: payments.discountCode,
        status: payments.status,
        platform: payments.platform,
        trackId: payments.trackId,
        refNumber: payments.refNumber,
        createdAt: payments.createdAt,
        paidAt: payments.paidAt,
      })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.userId))
      .orderBy(desc(payments.createdAt))
      .limit(n);

    const rows = status ? await base.where(eq(payments.status, status)) : await base;
    return c.json({ payments: rows });
  });

  r.get("/admin/discounts", async (c) => {
    const rows = await db.select().from(discounts).orderBy(discounts.code);
    return c.json({ discounts: rows });
  });

  r.post("/admin/discounts", async (c) => {
    const body = discountCreateBody.parse(await readJson(c));
    const code = body.code.toUpperCase();
    const [existing] = await db.select().from(discounts).where(eq(discounts.code, code)).limit(1);
    if (existing) throw badRequest("duplicate_code", "Code already exists");

    const [row] = await db
      .insert(discounts)
      .values({
        code,
        percent: body.percent,
        maxUses: body.maxUses ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        phone: body.phone || null,
        active: true,
      })
      .returning();
    return c.json({ ok: true, discount: row });
  });

  r.post("/admin/discounts/:code", async (c) => {
    const code = c.req.param("code");
    const body = discountUpdateBody.parse(await readJson(c));
    const patch: Record<string, unknown> = {};
    if (body.active !== undefined) patch.active = body.active;
    if (body.maxUses !== undefined) patch.maxUses = body.maxUses;
    if (body.expiresAt !== undefined)
      patch.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (!Object.keys(patch).length) throw badRequest("empty_patch", "Nothing to update");

    const [row] = await db
      .update(discounts)
      .set(patch)
      .where(eq(discounts.code, code.toUpperCase()))
      .returning();
    if (!row) throw notFound("unknown_code", "No such discount");
    return c.json({ ok: true, discount: row });
  });

  return r;
}
