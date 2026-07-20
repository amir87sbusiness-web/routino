/**
 * Payment routes — thin edge adapter.
 *
 * ALL money logic lives in shared/services/payment-flow.ts (byte-identical to
 * the backend copy the payment test suite exercises) and the result page in
 * shared/lib/pay-result-page.ts. If you are changing payment behaviour, you are
 * in the wrong file.
 */
import { Hono } from "hono";
import { z } from "zod";
import { makeAuthenticate, readJson, requireUser, type AppEnv, type Deps } from "../deps.ts";
import { badRequest } from "../shared/lib/http-errors.ts";
import { renderResultPage } from "../shared/lib/pay-result-page.ts";
import {
  checkoutPayment,
  handlePaymentCallback,
  pollPayment,
  UUID_RE,
} from "../shared/services/payment-flow.ts";
import { checkDiscount, quote } from "../shared/services/pricing.ts";

const quoteBody = z.object({
  planId: z.string().min(1).max(32),
  code: z.string().max(64).optional(),
});

const checkoutBody = quoteBody.extend({
  platform: z.enum(["web", "android", "ios"]).optional(),
});

export function paymentRoutes(deps: Deps) {
  const { db, env, psp } = deps;
  const now = () => new Date(deps.now());
  const auth = makeAuthenticate(deps);
  const r = new Hono<AppEnv>();

  /** Price preview. Invalid codes come back as a reason, not an error. */
  r.post("/payments/quote", auth, async (c) => {
    const user = requireUser(c);
    const body = quoteBody.parse(await readJson(c));
    const t = now();
    const q = await quote(db, body.planId, body.code ?? null, user.id, user.phone, t, 0, true);
    const d = await checkDiscount(db, body.code ?? null, user.id, user.phone, t);
    return c.json({ quote: q, discount: d });
  });

  r.post("/payments/checkout", auth, async (c) => {
    const user = requireUser(c);
    const body = checkoutBody.parse(await readJson(c));
    return c.json(await checkoutPayment(db, env, psp, user, body, now()));
  });

  /** The PSP redirects the user's browser here after the gateway. Public. */
  r.get("/payments/callback", async (c) => {
    const result = await handlePaymentCallback(db, psp, c.req.query(), now());
    return c.html(renderResultPage(env, result));
  });

  r.get("/payments/:id", auth, async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed payment id");
    return c.json(await pollPayment(db, psp, user.id, id, now()));
  });

  return r;
}
