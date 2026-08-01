/**
 * Payment routes — thin Fastify adapter.
 *
 * ALL money logic lives in `services/payment-flow.ts` (framework-free, shared
 * verbatim with the Supabase Edge Function) and the result page in
 * `lib/pay-result-page.ts`. This file only parses requests and renders
 * responses; if you are changing payment behaviour, you are in the wrong file.
 *
 *   POST /payments/quote      price preview + discount validation (authed)
 *   POST /payments/checkout   create payment, register with PSP, hand back URL (authed)
 *   GET  /payments/callback   the PSP redirects the user's browser here (public)
 *   GET  /payments/:id        status poll for the app after returning (authed)
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { renderResultPage } from "../lib/pay-result-page.js";
import { requireUser } from "../plugins/auth.js";
import { badRequest } from "../plugins/errors.js";
import { checkoutPayment, handlePaymentCallback, pollPayment, UUID_RE } from "../services/payment-flow.js";
import { checkDiscount, quote } from "../services/pricing.js";

const quoteBody = z.object({
  planId: z.string().min(1).max(32),
  code: z.string().max(64).optional(),
});

const checkoutBody = quoteBody.extend({
  platform: z.enum(["web", "android", "ios"]).optional(),
});

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, psp } = app.deps;
  const now = () => new Date(app.deps.now());

  /** Price preview. Invalid codes come back as a reason, not an error — the UI
   * shows "کد منقضی شده" instead of a failed request. */
  app.post("/payments/quote", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const body = quoteBody.parse(req.body);
    const t = now();
    const q = await quote(db, body.planId, body.code ?? null, user.id, user.phone, t, 0, true);
    const d = await checkDiscount(db, body.code ?? null, user.id, user.phone, t);
    return { quote: q, discount: d };
  });

  app.post("/payments/checkout", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const body = checkoutBody.parse(req.body);
    return checkoutPayment(db, env, psp, user, body, now());
  });

  /** The PSP redirects the user's browser here after the gateway. */
  app.get("/payments/callback", async (req, reply) => {
    // `unknown`, not `string | undefined`: a repeated key (`?a=1&a=2`) parses to
    // an array, and this endpoint is public. `handlePaymentCallback` normalises.
    const qs = req.query as Record<string, unknown>;
    const result = await handlePaymentCallback(db, psp, qs, now());
    return reply.type("text/html; charset=utf-8").send(renderResultPage(env, result));
  });

  app.get("/payments/:id", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed payment id");
    return pollPayment(db, psp, user.id, id, now());
  });
};
