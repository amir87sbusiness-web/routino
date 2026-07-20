/** Subscription routes — thin edge adapter mirroring
 * backend/src/routes/subscriptions.ts (see that file for the import-bounding
 * rationale). */
import { Hono } from "hono";
import { z } from "zod";
import { makeAuthenticate, readJson, requireUser, type AppEnv, type Deps } from "../deps.ts";
import {
  ensureExpiresAt,
  hasSettledGrant,
  listGrants,
  readEntitlement,
} from "../shared/services/entitlement.ts";

const importBody = z.object({
  planId: z.string().min(1).max(32),
  /** Epoch ms, as the client's local `Subscription` stores it. */
  expiresAt: z.number().int().positive(),
  startedAt: z.number().int().nonnegative().optional(),
  trial: z.boolean().optional(),
});

export function subscriptionRoutes(deps: Deps) {
  const { db, env } = deps;
  const now = () => new Date(deps.now());
  const auth = makeAuthenticate(deps);
  const r = new Hono<AppEnv>();

  r.get("/subscriptions/me", auth, async (c) => {
    const user = requireUser(c);
    return c.json({ entitlement: await readEntitlement(db, user.id, now()) });
  });

  /** Imports a legacy client-side subscription — trusted exactly once, bounded
   * (once per account, capped at IMPORT_MAX_DAYS, never stacks). */
  r.post("/subscriptions/import", auth, async (c) => {
    const user = requireUser(c);
    const body = importBody.parse(await readJson(c));
    const t = now();

    if (await hasSettledGrant(db, user.id)) {
      // Already paid or already imported — replaying this must not extend anything.
      return c.json({
        entitlement: await readEntitlement(db, user.id, t),
        imported: false,
        reason: "already_settled",
      });
    }

    const claimed = new Date(body.expiresAt);
    if (claimed <= t) {
      return c.json({
        entitlement: await readEntitlement(db, user.id, t),
        imported: false,
        reason: "already_expired",
      });
    }

    const cap = new Date(t.getTime() + env.IMPORT_MAX_DAYS * 86_400_000);
    const granted = claimed > cap ? cap : claimed;

    const entitlement = await ensureExpiresAt(
      db,
      user.id,
      {
        planId: body.planId,
        claimed: granted,
        source: "migration",
        // Keep exactly what was claimed, so an implausible import is visible later.
        note: JSON.stringify({
          claimed: body.expiresAt,
          capped: granted.getTime() !== claimed.getTime(),
          trial: body.trial ?? false,
        }),
      },
      t,
    );

    return c.json({ entitlement, imported: true, capped: granted.getTime() !== claimed.getTime() });
  });

  /** Support view: the full ledger of why this account has the access it has. */
  r.get("/subscriptions/grants", auth, async (c) => {
    const user = requireUser(c);
    return c.json({ grants: await listGrants(db, user.id) });
  });

  return r;
}
