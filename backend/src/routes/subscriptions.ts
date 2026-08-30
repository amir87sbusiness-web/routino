import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireUser } from "../plugins/auth.js";
import {
  ensureExpiresAt,
  hasSettledGrant,
  listGrants,
  readEntitlement,
  startTrialOnce,
} from "../services/entitlement.js";
import { settleOpenPayments } from "../services/payment-flow.js";

/** The largest instant a JS `Date` can represent; past this it is Invalid Date. */
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

const importBody = z.object({
  planId: z.string().min(1).max(32),
  /** Epoch ms, as the client's local `Subscription` stores it. */
  expiresAt: z.number().int().positive(),
  startedAt: z.number().int().nonnegative().optional(),
  trial: z.boolean().optional(),
});

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, psp } = app.deps;
  const now = () => new Date(app.deps.now());

  app.get("/subscriptions/me", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const t = now();
    await settleOpenPayments(db, psp, user.id, t);
    return { entitlement: await readEntitlement(db, user.id, t) };
  });

  app.post("/subscriptions/trial/start", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    return startTrialOnce(db, user.id, now());
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
      return {
        entitlement: await readEntitlement(db, user.id, t),
        imported: false,
        reason: "already_settled",
      };
    }

    // `z.number().int().positive()` still admits values past the largest instant
    // a Date can represent, and `new Date()` then yields Invalid Date. BOTH
    // guards below miss it, because every comparison against NaN is false — so
    // it reached `ensureExpiresAt`, whose `.toISOString()` threw RangeError and
    // turned a junk field into a 500 on a grant endpoint.
    //
    // Clamped rather than rejected: this endpoint exists to rescue legacy users
    // whose only proof of a subscription is local, so a corrupt stored value
    // should land on the same cap an over-large claim already gets, not lock
    // them out with an error. The raw claim is still recorded in the note below.
    const claimed = new Date(Math.min(body.expiresAt, MAX_TIMESTAMP_MS));
    if (claimed <= t) {
      return {
        entitlement: await readEntitlement(db, user.id, t),
        imported: false,
        reason: "already_expired",
      };
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

    return { entitlement, imported: true, capped: granted.getTime() !== claimed.getTime() };
  });

  /** Support view: the full ledger of why this account has the access it has. */
  app.get("/subscriptions/grants", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    return { grants: await listGrants(db, user.id) };
  });
};
