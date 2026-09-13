import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { rowsOf } from "../db/client.js";
import { payments } from "../db/schema.js";
import { PAYMENT_VERIFY_LEASE_MS, settleOne } from "../services/payment-flow.js";

const RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const INQUIRY_AFTER_MS = 10 * 60 * 1000;
const MANUAL_REVIEW_AFTER_MS = 35 * 60 * 1000;
const INQUIRY_RETRY_MS = 5 * 60 * 1000;
const MANUAL_REVIEW_RETRY_MS = 60 * 60 * 1000;
const RECOVERY_LIMIT = 100;
const INQUIRY_LIMIT = 20;
const RECOVERY_BATCH_SLOT_MS = 5 * 60 * 1000;
const RECONCILE_BUDGET_MS = 27_000;
const VERIFY_START_RESERVE_MS = 21_000;

const secretEquals = (a: string, b: string): boolean => {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};

const canStartProviderCall = (deadlineMs: number): boolean =>
  Date.now() + VERIFY_START_RESERVE_MS <= deadlineMs;

async function configuredSecret(app: Parameters<FastifyPluginAsync>[0]): Promise<string> {
  const fromEnv = app.deps.env.PAYMENT_RECONCILE_SECRET.trim();
  if (fromEnv) return fromEnv;
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

  const prepareVerify = async (payment: typeof payments.$inferSelect, t: Date) => {
    const staleBefore = new Date(t.getTime() - PAYMENT_VERIFY_LEASE_MS);
    const [prepared] = await db
      .update(payments)
      .set({ status: "redirected", verifyStartedAt: null, nextVerifyAt: null, updatedAt: t })
      .where(
        and(
          eq(payments.id, payment.id),
          isNull(payments.appliedAt),
          or(isNull(payments.verifyStartedAt), lt(payments.verifyStartedAt, staleBefore)),
        ),
      )
      .returning();
    return prepared;
  };

  const verifyCandidate = async (
    payment: typeof payments.$inferSelect,
    t: Date,
  ): Promise<boolean> => {
    const prepared = await prepareVerify(payment, t);
    if (!prepared) return false;
    await settleOne(db, psp, prepared, t, env.PSP_PROVIDER_MAX_CONCURRENCY);
    const [fresh] = await db
      .select({ appliedAt: payments.appliedAt })
      .from(payments)
      .where(eq(payments.id, payment.id))
      .limit(1);
    return Boolean(fresh?.appliedAt);
  };

  const runRecovery = async () => {
    const deadlineMs = Date.now() + RECONCILE_BUDGET_MS;
    const t = new Date(app.deps.now());
    const since = new Date(t.getTime() - RECOVERY_WINDOW_MS);
    const listed = await (async () => {
      try {
        return psp.listUnverified
          ? await psp.listUnverified()
          : { kind: "unknown" as const, code: undefined };
      } catch (err) {
        app.log.error({ err }, "payment recovery unVerified lookup failed");
        return { kind: "unknown" as const, code: undefined };
      }
    })();
    const unverifiedAvailable = listed.kind === "ok";
    const uniqueItems =
      listed.kind === "ok"
        ? [...new Map(listed.items.map((item) => [item.authority, item] as const)).values()]
        : [];
    const batchStart =
      uniqueItems.length > RECOVERY_LIMIT
        ? (Math.floor(t.getTime() / RECOVERY_BATCH_SLOT_MS) * RECOVERY_LIMIT) % uniqueItems.length
        : 0;
    const items =
      uniqueItems.length <= RECOVERY_LIMIT
        ? uniqueItems
        : [...uniqueItems.slice(batchStart), ...uniqueItems.slice(0, batchStart)].slice(
            0,
            RECOVERY_LIMIT,
          );
    const authorities = items.map((item) => item.authority);
    const candidates =
      authorities.length === 0
        ? []
        : await db
            .select()
            .from(payments)
            .where(
              and(
                isNull(payments.appliedAt),
                isNotNull(payments.authority),
                inArray(payments.authority, authorities),
                gt(payments.createdAt, since),
              ),
            );
    const byAuthority = new Map(
      candidates.flatMap((payment) =>
        payment.authority ? [[payment.authority, payment] as const] : [],
      ),
    );

    let matched = 0;
    let checked = 0;
    let inquired = 0;
    let recovered = 0;
    let skipped = 0;
    let reviewed = 0;
    let closed = 0;
    let errors = 0;
    let stoppedEarly = false;

    for (const item of items) {
      const payment = byAuthority.get(item.authority);
      if (!payment || payment.amountRial !== item.amountRial) {
        skipped += 1;
        if (payment) {
          app.log.error(
            {
              paymentId: payment.id,
              storedAmountRial: payment.amountRial,
              providerAmountRial: item.amountRial,
            },
            "unverified payment amount mismatch",
          );
        }
        continue;
      }
      matched += 1;
      if (!canStartProviderCall(deadlineMs)) {
        stoppedEarly = true;
        break;
      }
      try {
        checked += 1;
        if (await verifyCandidate(payment, t)) recovered += 1;
      } catch (err) {
        errors += 1;
        app.log.error({ paymentId: payment.id, err }, "payment recovery Verify failed");
      }
    }

    if (!stoppedEarly && psp.inquire) {
      const stale = await db
        .select()
        .from(payments)
        .where(
          and(
            isNull(payments.appliedAt),
            isNotNull(payments.authority),
            gt(payments.createdAt, since),
            lt(payments.createdAt, new Date(t.getTime() - INQUIRY_AFTER_MS)),
            or(
              and(
                inArray(payments.status, ["redirected", "verifying", "canceled", "paid"]),
                lt(payments.updatedAt, new Date(t.getTime() - INQUIRY_RETRY_MS)),
              ),
              and(
                eq(payments.status, "manual_review"),
                lt(payments.updatedAt, new Date(t.getTime() - MANUAL_REVIEW_RETRY_MS)),
              ),
            ),
          ),
        )
        .orderBy(asc(payments.createdAt))
        .limit(INQUIRY_LIMIT);

      for (const payment of stale) {
        if (!payment.authority || authorities.includes(payment.authority)) continue;
        if (inquired >= INQUIRY_LIMIT) break;
        if (!canStartProviderCall(deadlineMs)) {
          stoppedEarly = true;
          break;
        }
        try {
          const inquiry = await psp.inquire(payment.authority);
          inquired += 1;
          checked += 1;
          if (inquiry.kind === "paid" || inquiry.kind === "verified") {
            if (await verifyCandidate(payment, t)) recovered += 1;
            continue;
          }
          if (inquiry.kind === "failed" || inquiry.kind === "reversed") {
            await db
              .update(payments)
              .set({ status: "failed", pspResult: inquiry.code ?? null, updatedAt: t })
              .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
            closed += 1;
            continue;
          }
          const shouldReview = t.getTime() - payment.createdAt.getTime() >= MANUAL_REVIEW_AFTER_MS;
          await db
            .update(payments)
            .set({
              status: shouldReview ? "manual_review" : payment.status,
              pspResult: inquiry.code ?? null,
              updatedAt: t,
            })
            .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
          if (shouldReview) reviewed += 1;
        } catch (err) {
          errors += 1;
          app.log.error({ paymentId: payment.id, err }, "payment recovery Inquiry failed");
        }
      }
    }

    const success = unverifiedAvailable || inquired > 0;
    return {
      success,
      mode: "authoritative",
      error: success ? undefined : "provider_unverified_unavailable",
      providerCode: listed.kind === "ok" ? null : (listed.code ?? null),
      unverifiedAvailable,
      discovered: items.length,
      matched,
      checked,
      inquired,
      recovered,
      skipped,
      reviewed,
      closed,
      errors,
      stoppedEarly,
    } as const;
  };

  const authorize = async (req: { headers: Record<string, unknown> }) => {
    const expected = await configuredSecret(app);
    const got = req.headers["x-payment-reconcile-secret"];
    return Boolean(expected && typeof got === "string" && secretEquals(got, expected));
  };

  app.post("/internal/payments/relay-auth", async (req, reply) => {
    const got = req.headers["x-relay-candidate"];
    const candidate = typeof got === "string" ? got : "";
    const expected = env.PROXY_SECRET || "";
    if (!expected || !candidate || !secretEquals(candidate, expected)) {
      return reply.code(403).send();
    }
    return reply.code(204).send();
  });

  const reconcile = async (req: { headers: Record<string, unknown> }, reply: FastifyReply) => {
    if (!(await authorize(req))) return reply.code(401).send({ error: "unauthorized" });
    const result = await runRecovery();
    return result.success ? result : reply.code(502).send(result);
  };

  app.post("/internal/payments/reconcile", reconcile);
  // Compatibility alias while the production cron is moved to the unified route.
  app.post("/internal/payments/reconcile-unverified", reconcile);
};
