import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { and, asc, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps.ts";
import { rowsOf } from "../shared/db/client.ts";
import { payments } from "../shared/db/schema.ts";
import { settleOne } from "../shared/services/payment-flow.ts";

const RECOVERABLE_STATUSES = [
  "pending",
  "requesting",
  "redirected",
  "provider_unknown",
  "verifying",
  "operational_error",
  "manual_review",
] as const;

const RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

  const runSweep = async (limit: number) => {
    const t = new Date(deps.now());
    const since = new Date(t.getTime() - RECOVERY_WINDOW_MS);
    const open = await db
      .select()
      .from(payments)
      .where(
        and(
          isNull(payments.appliedAt),
          isNotNull(payments.authority),
          gt(payments.createdAt, since),
          inArray(payments.status, [...RECOVERABLE_STATUSES]),
          or(isNull(payments.nextVerifyAt), lte(payments.nextVerifyAt, t)),
        ),
      )
      .orderBy(asc(payments.createdAt))
      .limit(limit);

    let checked = 0;
    let recovered = 0;
    let stillOpen = 0;
    let errors = 0;

    for (const payment of open) {
      checked += 1;
      try {
        if (await settleOne(db, psp, payment, t, env.PSP_PROVIDER_MAX_CONCURRENCY)) {
          recovered += 1;
        } else {
          stillOpen += 1;
        }
      } catch (err) {
        errors += 1;
        console.error("payment recovery item failed", { paymentId: payment.id, err });
      }
    }

    return { success: true, checked, recovered, stillOpen, errors };
  };

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
