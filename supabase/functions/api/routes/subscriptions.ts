/** Subscription routes — thin edge adapter mirroring
 * backend/src/routes/subscriptions.ts (see that file for the import-bounding
 * rationale). */
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { makeAuthenticate, readJson, requireUser, type AppEnv, type Deps } from "../deps.ts";
import { users } from "../shared/db/schema.ts";
import { unauthorized } from "../shared/lib/http-errors.ts";
import {
  ensureExpiresAt,
  hasSettledGrant,
  listGrants,
  readEntitlement,
  startTrialOnce,
} from "../shared/services/entitlement.ts";
import { settleOpenPayments } from "../shared/services/payment-flow.ts";
import { issueAccessToken } from "../shared/services/tokens.ts";

/** The largest instant a JS `Date` can represent; past this it is Invalid Date. */
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

const importBody = z.object({
  planId: z.string().min(1).max(32),
  /** Epoch ms, as the client's local `Subscription` stores it. */
  expiresAt: z.number().int().positive(),
  startedAt: z.number().int().nonnegative().optional(),
  trial: z.boolean().optional(),
});

export function subscriptionRoutes(deps: Deps) {
  const { db, env, psp } = deps;
  const now = () => new Date(deps.now());
  const auth = makeAuthenticate(deps);
  const r = new Hono<AppEnv>();

  r.get("/subscriptions/me", auth, async (c) => {
    const user = requireUser(c);
    const t = now();
    await settleOpenPayments(db, psp, user.id, t, env.PSP_PROVIDER_MAX_CONCURRENCY);
    return c.json({ entitlement: await readEntitlement(db, user.id, t) });
  });

  r.post("/subscriptions/trial/start", auth, async (c) => {
    const user = requireUser(c);
    const t = now();
    const result = await startTrialOnce(db, user.id, t);
    const tokens = await issueAccessToken(env, user.id, t, {
      notAfter: result.entitlement.deletionAt ? new Date(result.entitlement.deletionAt) : null,
    });
    return c.json({ ...result, ...tokens });
  });

  /** Imports a legacy client-side subscription. Only accounts that existed
   * before LEGACY_IMPORT_CUTOFF may use this inherently-untrusted migration
   * bridge; future public signups are fail-closed. */
  r.post("/subscriptions/import", auth, async (c) => {
    const user = requireUser(c);
    const body = importBody.parse(await readJson(c));
    const t = now();

    const [account] = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (!account) throw unauthorized("unknown_user", "User no longer exists");

    if (account.createdAt >= new Date(env.LEGACY_IMPORT_CUTOFF)) {
      return c.json({
        entitlement: await readEntitlement(db, user.id, t),
        imported: false,
        reason: "not_legacy_account",
      });
    }

    if (await hasSettledGrant(db, user.id)) {
      // Already paid or already imported — replaying this must not extend anything.
      return c.json({
        entitlement: await readEntitlement(db, user.id, t),
        imported: false,
        reason: "already_settled",
      });
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
