import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps.ts";
import { rowsOf } from "../shared/db/client.ts";
import { runPaymentRecoverySweep } from "../shared/services/payment-recovery.ts";

const secretEquals = (a: string, b: string): boolean => {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
};

async function configuredSecret(deps: Deps): Promise<string> {
  const fromEnv = deps.env.PAYMENT_RECONCILE_SECRET.trim();
  if (fromEnv) return fromEnv;

  try {
    const rows = rowsOf<{ secret: string }>(
      await deps.db.execute(sql`
        select decrypted_secret as secret
        from vault.decrypted_secrets
        where name = 'routino_payment_reconcile_secret'
        limit 1
      `),
    );
    return typeof rows[0]?.secret === "string" ? rows[0].secret : "";
  } catch {
    return "";
  }
}

export function paymentRecoveryRoutes(deps: Deps) {
  const { db, env, psp } = deps;
  const r = new Hono<AppEnv>();

  const authorized = async (got: string | undefined) => {
    const expected = await configuredSecret(deps);
    return Boolean(expected && got && secretEquals(got, expected));
  };

  const runSweep = (limit: number) =>
    runPaymentRecoverySweep(db, psp, new Date(deps.now()), {
      limit,
      maxConcurrent: env.PSP_PROVIDER_MAX_CONCURRENCY,
      onError: (paymentId, err) =>
        console.error("payment recovery item failed", { paymentId, err }),
    });

  /** Pages relay cannot read Edge secrets. It presents the candidate secret it
   * received from the caller; this endpoint validates it against the live
   * PROXY_SECRET. The surrounding Edge middleware already guarantees this
   * validator itself was reached through api.routino.me's trusted Worker. */
  r.post("/internal/payments/relay-auth", (c) => {
    const candidate = c.req.header("x-relay-candidate") || "";
    const expected = env.PROXY_SECRET || "";
    if (!expected || !candidate || !secretEquals(candidate, expected)) {
      return c.body(null, 403);
    }
    return c.body(null, 204);
  });

  r.post("/internal/payments/reconcile", async (c) => {
    if (!(await authorized(c.req.header("x-payment-reconcile-secret")))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json(await runSweep(30));
  });

  r.post("/internal/payments/reconcile-unverified", async (c) => {
    if (!(await authorized(c.req.header("x-payment-reconcile-secret")))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json(await runSweep(80));
  });

  return r;
}
