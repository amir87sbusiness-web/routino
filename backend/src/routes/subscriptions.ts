import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireUser } from "../plugins/auth.js";
import { badRequest } from "../plugins/errors.js";
import { ensureExpiresAt, hasSettledGrant, listGrants, readEntitlement } from "../services/entitlement.js";

const importBody = z.object({
  planId: z.string().min(1).max(32),
  /** Epoch ms, as the client's local `Subscription` stores it. */
  expiresAt: z.number().int().positive(),
  startedAt: z.number().int().nonnegative().optional(),
  trial: z.boolean().optional(),
});

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  const { db, env } = app.deps;
  const now = () => new Date(app.deps.now());

  app.get("/subscriptions/me", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    return { entitlement: await readEntitlement(db, user.id, now()) };
  });

  /**
   * Imports a legacy client-side subscription.
   *
   * Necessary because every existing user's proof of a trial or paid plan lives
   * ONLY in their device's localStorage. Flipping the paywall to server
   * entitlement without this locks out the entire userbase on day one.
   *
   * It is also inherently untrusted: the body is client-authored, so anyone can
   * claim `expiresAt: 2099`. It cannot be validated — only BOUNDED:
   *   - once per account, and never after a payment or a previous import
   *   - capped at now + IMPORT_MAX_DAYS
   *   - raises expiry to max(current, claimed); never stacks on the trial
   *   - the raw claim is recorded on the grant for audit
   * Trust the client exactly once, at migration, and never again.
   */
  app.post("/subscriptions/import", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const body = importBody.parse(req.body);
    const t = now();

    if (await hasSettledGrant(db, user.id)) {
      // Already paid or already imported — replaying this must not extend anything.
      return { entitlement: await readEntitlement(db, user.id, t), imported: false, reason: "already_settled" };
    }

    const claimed = new Date(body.expiresAt);
    if (claimed <= t) {
      return { entitlement: await readEntitlement(db, user.id, t), imported: false, reason: "already_expired" };
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
        note: JSON.stringify({ claimed: body.expiresAt, capped: granted.getTime() !== claimed.getTime(), trial: body.trial ?? false }),
      },
      t,
    );

    return { entitlement, imported: true, capped: granted.getTime() !== claimed.getTime() };
  });

  /** Support view: the full ledger of why this account has the access it has. */
  app.get("/subscriptions/grants", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    return { grants: await listGrants(db, user.id) };
  });
};
