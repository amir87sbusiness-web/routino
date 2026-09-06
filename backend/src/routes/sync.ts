/**
 * Delta sync endpoints. All the logic is in `services/sync.ts`; this is the HTTP
 * adapter, and its Hono twin under `supabase/functions/api/routes/sync.ts` is
 * hand-maintained.
 *
 * Deliberately NOT entitlement-gated. Sync is how a user's data survives losing
 * a phone, and holding it back from someone on a trial — or someone whose
 * subscription lapsed — would mean the app quietly stops protecting the data it
 * already has. Auth is the boundary here; paying is not.
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireUser } from "../plugins/auth.js";
import { readEntitlement } from "../services/entitlement.js";
import { settleOpenPayments } from "../services/payment-flow.js";
import { touchUserActivity } from "../services/user-activity.js";
import {
  MAX_PUSH_RECORDS,
  PULL_PAGE_SIZE,
  exchangeRecords,
  pullRecords,
  pushRecords,
  type PushRecord,
} from "../services/sync.js";

const pushBody = z.object({
  records: z
    .array(
      z.object({
        kind: z.string().min(1).max(32),
        // jsonb; the service bounds its serialised size. Absent on tombstones.
        id: z.string().min(1).max(128),
        data: z.unknown(),
        updatedAt: z.number().int().nonnegative(),
        deleted: z.boolean(),
      }),
    )
    .max(MAX_PUSH_RECORDS),
});

const pullQuery = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(PULL_PAGE_SIZE).default(PULL_PAGE_SIZE),
});

const exchangeBody = pushBody
  .extend({
    protocolVersion: z.literal(2),
    cursor: z.number().int().nonnegative().default(0),
    limit: z.number().int().positive().max(PULL_PAGE_SIZE).default(PULL_PAGE_SIZE),
    includeAccountState: z.boolean().default(false),
    fullResyncGcSeq: z.number().int().nonnegative().optional(),
  })
  .refine((input) => input.fullResyncGcSeq === undefined || input.records.length === 0, {
    message: "full resync continuation must be read-only",
    path: ["records"],
  });

export const syncRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, psp } = app.deps;
  const now = () => new Date(app.deps.now());

  app.post("/sync/exchange", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const input = exchangeBody.parse(req.body);
    const t = now();
    const page = await exchangeRecords(
      db,
      user.id,
      input.cursor,
      input.records as PushRecord[],
      t,
      input.limit,
      input.fullResyncGcSeq,
    );
    if (!input.includeAccountState || page.hasMore || page.reset) return page;
    await settleOpenPayments(db, psp, user.id, t, env.PSP_PROVIDER_MAX_CONCURRENCY);
    return { ...page, entitlement: await readEntitlement(db, user.id, t) };
  });

  /**
   * Uploads this device's pending changes.
   *
   * The app-wide 64 KB body limit is the real cap here, and it is why the client
   * chunks rather than sending its whole outbox: a first sync of a year of
   * history is thousands of rows.
   */
  app.post("/sync/push", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const { records } = pushBody.parse(req.body);
    return pushRecords(db, user.id, records as PushRecord[], now());
  });

  /**
   * Everything written above `cursor`, oldest first. The client loops while
   * `hasMore`, and wipes and restarts from 0 when `reset` comes back true.
   *
   * The final page also carries the caller's entitlement, which is why the app
   * no longer calls `GET /v1/subscriptions/me` on boot. That endpoint still
   * exists and still works — carrying the entitlement here avoids one separate
   * network round trip for every app open.
   *
   * Only on the last page: a first sync of a year of history is several pages,
   * and the answer is identical on each.
   *
   * The same last page is also where a stranded payment gets finished —
   * `settleOpenPayments`, before the entitlement is read, so a user whose
   * gateway callback never arrived is simply subscribed by the time the app
   * paints. On the normal path that is one indexed SELECT returning nothing.
   *
   * Legacy clients still use pull/push instead of exchange. Count activity here
   * only on the final pull page so those clients are covered without adding any
   * extra client request or repeating the activity statement for pagination.
   */
  app.get("/sync/pull", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const { cursor, limit } = pullQuery.parse(req.query);
    const t = now();
    const page = await pullRecords(db, user.id, cursor, limit);
    if (page.hasMore) return page;
    await touchUserActivity(db, user.id, t);
    await settleOpenPayments(db, psp, user.id, t, env.PSP_PROVIDER_MAX_CONCURRENCY);
    return { ...page, entitlement: await readEntitlement(db, user.id, t) };
  });
};
