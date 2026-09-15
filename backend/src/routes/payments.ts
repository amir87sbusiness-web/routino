/**
 * Payment routes — thin Fastify adapter.
 *
 * ALL money logic lives in `services/payment-flow.ts` (framework-free, shared
 * verbatim with the Supabase Edge Function) and the result page in
 * `lib/pay-result-page.ts`. This file only parses requests and renders
 * responses; if you are changing payment behaviour, you are in the wrong file.
 *
 *   POST /payments/quote       one price preview + discount validation (authed)
 *   POST /payments/quote-batch several previews in one server invocation (authed)
 *   POST /payments/checkout    create payment, register with PSP, hand back URL (authed)
 *   GET  /payments/callback    the PSP redirects the user's browser here (public)
 *   GET  /payments/:id         status poll for the app after returning (authed)
 */
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "../db/schema.js";
import { renderResultPage } from "../lib/pay-result-page.js";
import { requireUser } from "../plugins/auth.js";
import { badRequest, unauthorized } from "../plugins/errors.js";
import {
  checkoutPayment,
  handlePaymentCallback,
  pollPayment,
  UUID_RE,
} from "../services/payment-flow.js";
import { quoteWithDiscount } from "../services/pricing.js";

const planId = z.string().min(1).max(32);
const quoteBody = z.object({
  planId,
  code: z.string().max(64).optional(),
});
const quoteBatchBody = z.object({
  planIds: z.array(planId).min(1).max(6),
  code: z.string().max(64).optional(),
});

const checkoutBody = quoteBody.extend({
  attemptId: z.string().uuid(),
  platform: z.enum(["web", "android", "ios"]).optional(),
});

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, psp } = app.deps;
  const now = () => new Date(app.deps.now());
  const paymentUser = async (id: string) => {
    const [user] = await db
      .select({ id: users.id, phone: users.phone })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw unauthorized("unknown_user", "User no longer exists");
    return user;
  };

  /** Price preview. Invalid codes come back as a reason, not an error — the UI
   * shows "کد منقضی شده" instead of a failed request. */
  app.post("/payments/quote", { preHandler: app.authenticate }, async (req) => {
    const auth = requireUser(req);
    const user = await paymentUser(auth.id);
    const body = quoteBody.parse(req.body);
    const t = now();
    return quoteWithDiscount(db, body.planId, body.code ?? null, user.id, user.phone, t, 0, true);
  });

  /** The subscribe screen needs the same coupon evaluated for each visible plan.
   * Authenticate and enter the Edge function once, then keep the individual
   * price calculations sequential so DB peak load does not increase. */
  app.post("/payments/quote-batch", { preHandler: app.authenticate }, async (req) => {
    const auth = requireUser(req);
    const user = await paymentUser(auth.id);
    const body = quoteBatchBody.parse(req.body);
    const t = now();
    const uniquePlanIds = [...new Set(body.planIds)];
    const quotes = [];
    for (const currentPlanId of uniquePlanIds) {
      quotes.push(
        await quoteWithDiscount(
          db,
          currentPlanId,
          body.code ?? null,
          user.id,
          user.phone,
          t,
          0,
          true,
        ),
      );
    }
    return { quotes };
  });

  app.post("/payments/checkout", { preHandler: app.authenticate }, async (req) => {
    const auth = requireUser(req);
    const user = await paymentUser(auth.id);
    const body = checkoutBody.parse(req.body);
    const t = now();
    const result = await checkoutPayment(db, env, psp, user, body, t);

    return result;
  });

  /** The PSP redirects the user's browser here after the gateway. */
  app.get("/payments/callback", async (req, reply) => {
    // `unknown`, not `string | undefined`: a repeated key (`?a=1&a=2`) parses to
    // an array, and this endpoint is public. `handlePaymentCallback` normalises.
    const qs = req.query as Record<string, unknown>;
    const result = await handlePaymentCallback(
      db,
      psp,
      qs,
      now(),
      env.PSP_PROVIDER_MAX_CONCURRENCY,
    );
    return reply.type("text/html; charset=utf-8").send(renderResultPage(env, result));
  });

  app.get("/payments/:id", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed payment id");
    return pollPayment(db, user.id, id, now());
  });
};
