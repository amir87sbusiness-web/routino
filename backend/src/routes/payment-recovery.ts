import { and, asc, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { rowsOf } from "../db/client.js";
import { payments } from "../db/schema.js";
import { settleOne } from "../services/payment-flow.js";

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

async function configuredSecret(app: Parameters<FastifyPluginAsync>[0]): Promise<string> {
  const fromEnv = app.deps.env.PAYMENT_RECONCILE_SECRET.trim();
  if (fromEnv) return fromEnv;

  // Supabase stores the existing cron secret in Vault. Reading it here keeps the
  // recovery endpoint aligned with the already-scheduled pg_cron jobs without
  // copying the secret into source code. Non-Supabase deployments simply fall
  // through to disabled recovery unless PAYMENT_RECONCILE_SECRET is configured.
  try {
    const rows = rowsOf<{ secret: string }>(
      await app.deps.db.execute(sql`
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

export const paymentRecoveryRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, psp } = app.deps;

  const runSweep = async (limit: number) => {
    const t = new Date(app.deps.now());
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
        app.log.error({ paymentId: payment.id, err }, "payment recovery item failed");
      }
    }

    return { success: true, checked, recovered, stillOpen, errors };
  };

  const authorize = async (req: { headers: Record<string, unknown> }) => {
    const expected = await configuredSecret(app);
    const got = req.headers["x-payment-reconcile-secret"];
    return Boolean(expected && typeof got === "string" && got === expected);
  };

  app.post("/internal/payments/reconcile", async (req, reply) => {
    if (!(await authorize(req))) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return runSweep(30);
  });

  // Kept as a separate endpoint because production already has a second cron
  // pointing here. It intentionally runs the same authoritative DB sweep with a
  // larger batch; ZarinPal Verify remains the source of truth for every row.
  app.post("/internal/payments/reconcile-unverified", async (req, reply) => {
    if (!(await authorize(req))) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return runSweep(80);
  });
};
