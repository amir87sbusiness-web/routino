/**
 * Production-only payment recovery endpoints used by Supabase pg_cron.
 *
 * They deliberately reuse the same `settleOne` state machine as authenticated
 * payment polling. This file decides only WHICH already-created payments are
 * eligible for a bounded retry; it never computes prices, creates payments or
 * grants entitlement directly.
 *
 * Authentication uses the existing pg_cron secret stored in Supabase Vault.
 * The secret is compared inside Postgres and is never returned or logged.
 */
import {
  and,
  asc,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps.ts";
import { rowsOf } from "../shared/db/client.ts";
import { payments } from "../shared/db/schema.ts";
import { settleOne } from "../shared/services/payment-flow.ts";

const VERIFY_LEASE_MS = 30_000;
const MAX_AUTOMATIC_VERIFY_ATTEMPTS = 48;
const RECENT_WINDOW_MS = 72 * 60 * 60 * 1_000;
const WIDE_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

async function secretMatches(deps: Deps, provided: string | undefined): Promise<boolean> {
  if (!provided) return false;
  const result = await deps.db.execute(sql`
    select exists (
      select 1
        from vault.decrypted_secrets
       where name = 'routino_payment_reconcile_secret'
         and decrypted_secret = ${provided}
    ) as ok
  `);
  return rowsOf<{ ok: boolean }>(result)[0]?.ok === true;
}

async function recoverDuePayments(
  deps: Deps,
  options: { windowMs: number; limit: number },
): Promise<{ scanned: number; changed: number; errors: number }> {
  const t = new Date(deps.now());
  const oldest = new Date(t.getTime() - options.windowMs);
  const staleVerifyBefore = new Date(t.getTime() - VERIFY_LEASE_MS);

  const due = await deps.db
    .select()
    .from(payments)
    .where(
      and(
        isNull(payments.appliedAt),
        isNotNull(payments.authority),
        inArray(payments.status, ["redirected", "verifying", "operational_error"]),
        gte(payments.createdAt, oldest),
        lt(payments.verifyAttempts, MAX_AUTOMATIC_VERIFY_ATTEMPTS),
        or(isNull(payments.verifyStartedAt), lt(payments.verifyStartedAt, staleVerifyBefore)),
        or(isNull(payments.nextVerifyAt), lte(payments.nextVerifyAt, t)),
      ),
    )
    .orderBy(asc(sql`coalesce(${payments.nextVerifyAt}, ${payments.createdAt})`), asc(payments.createdAt))
    .limit(options.limit);

  let changed = 0;
  let errors = 0;
  for (const payment of due) {
    try {
      if (
        await settleOne(
          deps.db,
          deps.psp,
          payment,
          t,
          deps.env.PSP_PROVIDER_MAX_CONCURRENCY,
        )
      ) {
        changed += 1;
      }
    } catch (error) {
      errors += 1;
      console.error("payment recovery item failed", {
        paymentId: payment.id,
        error: error instanceof Error ? { name: error.name, message: error.message } : undefined,
      });
    }
  }

  return { scanned: due.length, changed, errors };
}

export function internalPaymentRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  const requireRecoverySecret = async (c: Parameters<Parameters<typeof r.use>[1]>[0], next: () => Promise<void>) => {
    if (!(await secretMatches(deps, c.req.header("x-payment-reconcile-secret")))) {
      return c.json({ error: "forbidden", message: "Recovery secret is invalid" }, 403);
    }
    await next();
  };

  r.use("/internal/payments/*", requireRecoverySecret);

  // Frequent sweep: current payment sessions only. Kept deliberately small so
  // a provider incident cannot turn the cron into a thundering herd.
  r.post("/internal/payments/reconcile", async (c) => {
    const result = await recoverDuePayments(deps, { windowMs: RECENT_WINDOW_MS, limit: 10 });
    return c.json({ ok: result.errors === 0, ...result }, result.errors === 0 ? 200 : 500);
  });

  // Wider safety sweep: catches stranded rows that aged out of the normal
  // app-open recovery window. It still obeys next_verify_at, the shared verify
  // lease, provider concurrency and the 48-attempt automatic ceiling.
  r.post("/internal/payments/reconcile-unverified", async (c) => {
    const result = await recoverDuePayments(deps, { windowMs: WIDE_WINDOW_MS, limit: 25 });
    return c.json({ ok: result.errors === 0, ...result }, result.errors === 0 ? 200 : 500);
  });

  return r;
}
