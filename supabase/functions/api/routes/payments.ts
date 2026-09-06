/**
 * Payment routes — thin edge adapter.
 *
 * ALL money logic lives in shared/services/payment-flow.ts (byte-identical to
 * the backend copy the payment test suite exercises) and the result page in
 * shared/lib/pay-result-page.ts. If you are changing payment behaviour, you are
 * in the wrong file.
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { html, makeAuthenticate, readJson, requireUser, type AppEnv, type Deps } from "../deps.ts";
import { users } from "../shared/db/schema.ts";
import { badRequest, unauthorized } from "../shared/lib/http-errors.ts";
import { renderResultPage } from "../shared/lib/pay-result-page.ts";
import {
  checkoutPayment,
  handlePaymentCallback,
  pollPayment,
  UUID_RE,
} from "../shared/services/payment-flow.ts";
import { quoteWithDiscount } from "../shared/services/pricing.ts";

const quoteBody = z.object({
  planId: z.string().min(1).max(32),
  code: z.string().max(64).optional(),
});

const checkoutBody = quoteBody.extend({
  attemptId: z.string().uuid(),
  platform: z.enum(["web", "android", "ios"]).optional(),
});

export function paymentRoutes(deps: Deps) {
  const { db, env, psp } = deps;
  const now = () => new Date(deps.now());
  const auth = makeAuthenticate(deps);
  const r = new Hono<AppEnv>();
  const paymentUser = async (id: string) => {
    const [user] = await db
      .select({ id: users.id, phone: users.phone })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user) throw unauthorized("unknown_user", "User no longer exists");
    return user;
  };

  /** Price preview. Invalid codes come back as a reason, not an error. */
  r.post("/payments/quote", auth, async (c) => {
    const authenticated = requireUser(c);
    const user = await paymentUser(authenticated.id);
    const body = quoteBody.parse(await readJson(c));
    const t = now();
    return c.json(
      await quoteWithDiscount(db, body.planId, body.code ?? null, user.id, user.phone, t, 0, true),
    );
  });

  r.post("/payments/checkout", auth, async (c) => {
    const authenticated = requireUser(c);
    const user = await paymentUser(authenticated.id);
    const body = checkoutBody.parse(await readJson(c));
    return c.json(await checkoutPayment(db, env, psp, user, body, now()));
  });

  /** The PSP redirects the user's browser here after the gateway. Public. */
  r.get("/payments/callback", async (c) => {
    // Preserve duplicate keys as arrays so the shared callback validator can
    // reject parameter pollution instead of Hono silently selecting one value.
    const query: Record<string, unknown> = Object.fromEntries(
      Object.entries(c.req.queries()).map(([key, values]) => [
        key,
        values.length === 1 ? values[0] : values,
      ]),
    );
    const result = await handlePaymentCallback(
      db,
      psp,
      query,
      now(),
      env.PSP_PROVIDER_MAX_CONCURRENCY,
    );
    return html(c, renderResultPage(env, result));
  });

  r.get("/payments/:id", auth, async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      throw badRequest("bad_id", "Malformed payment id");
    }
    return c.json(await pollPayment(db, psp, user.id, id, now(), env.PSP_PROVIDER_MAX_CONCURRENCY));
  });

  return r;
}
