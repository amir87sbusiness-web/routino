import { and, count, desc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { makeAuthenticate, requireUser, type AppEnv, type Deps } from "../deps.ts";
import { deviceSecurityEvents, devices, users } from "../shared/db/schema.ts";
import { notFound } from "../shared/lib/http-errors.ts";

const paramsBody = z.object({ id: z.string().uuid() });
const SWITCH_WINDOW_MS = 30 * 86_400_000;

export function deviceRoutes(deps: Deps) {
  const { db } = deps;
  const auth = makeAuthenticate(deps);
  const now = () => new Date(deps.now());
  const r = new Hono<AppEnv>();

  r.get("/devices/ping", auth, (c) => c.json({ ok: true as const }));

  r.get("/devices", auth, async (c) => {
    const caller = requireUser(c);
    const [account] = await db.select().from(users).where(eq(users.id, caller.id)).limit(1);
    if (!account) throw notFound("unknown_user", "No such user");
    const rollingStart = new Date(now().getTime() - SWITCH_WINDOW_MS);
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
    return c.json({
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
    });
  });

  r.post("/devices/:id/revoke", auth, async (c) => {
    const caller = requireUser(c);
    const { id } = paramsBody.parse({ id: c.req.param("id") });
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
    return c.json({ ok: true });
  });

  return r;
}
