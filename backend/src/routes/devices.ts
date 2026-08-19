import { and, count, desc, eq, gt } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { deviceSecurityEvents, devices, users } from "../db/schema.js";
import { requireUser } from "../plugins/auth.js";
import { notFound } from "../plugins/errors.js";
import { DEVICE_SWITCH_WINDOW_MS } from "../services/tokens.js";

const paramsBody = z.object({ id: z.string().uuid() });

export const deviceRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;
  const now = () => new Date(app.deps.now());

  app.get("/devices/ping", { preHandler: app.authenticate }, async () => {
    return { ok: true as const };
  });

  app.get("/devices", { preHandler: app.authenticate }, async (req) => {
    const caller = requireUser(req);
    const [account] = await db.select().from(users).where(eq(users.id, caller.id)).limit(1);
    if (!account) throw notFound("unknown_user", "No such user");

    const rollingStart = new Date(now().getTime() - DEVICE_SWITCH_WINDOW_MS);
    const since =
      account.deviceSwitchResetAt && account.deviceSwitchResetAt > rollingStart
        ? account.deviceSwitchResetAt
        : rollingStart;
    const [rows, switchRows] = await Promise.all([
      db
        .select()
        .from(devices)
        .where(eq(devices.userId, caller.id))
        .orderBy(desc(devices.lastSeenAt), desc(devices.createdAt)),
      db
        .select({ n: count() })
        .from(deviceSecurityEvents)
        .where(
          and(
            eq(deviceSecurityEvents.userId, caller.id),
            eq(deviceSecurityEvents.kind, "replacement"),
            gt(deviceSecurityEvents.createdAt, since),
          ),
        ),
    ]);

    return {
      maxActiveDevices: account.maxActiveDevices,
      switchCount30d: switchRows[0]?.n ?? 0,
      securityLocked: !!account.securityLockedAt,
      devices: rows.map((device) => ({
        id: device.id,
        name: device.name,
        platform: device.platform,
        browser: device.browser,
        os: device.os,
        firstSeenAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        revokedAt: device.revokedAt,
        revocationReason: device.revocationReason,
        current: device.id === caller.deviceId,
        active: !device.revokedAt,
      })),
    };
  });

  app.post("/devices/:id/revoke", { preHandler: app.authenticate }, async (req) => {
    const caller = requireUser(req);
    const { id } = paramsBody.parse(req.params);
    const [owned] = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.id, id), eq(devices.userId, caller.id)))
      .limit(1);
    if (!owned) throw notFound("unknown_device", "No such device");

    await db
      .update(devices)
      .set({ revokedAt: now(), revocationReason: "user_revoked" })
      .where(eq(devices.id, id));
    return { ok: true };
  });
};
