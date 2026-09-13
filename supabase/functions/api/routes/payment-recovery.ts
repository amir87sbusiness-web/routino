import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import type { AppEnv, Deps } from "../deps.ts";
import { rowsOf } from "../shared/db/client.ts";
import { payments } from "../shared/db/schema.ts";
import { PAYMENT_VERIFY_LEASE_MS, settleOne } from "../shared/services/payment-flow.ts";

const RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const INQUIRY_AFTER_MS = 10 * 60 * 1000;
const MANUAL_REVIEW_AFTER_MS = 35 * 60 * 1000;
const INQUIRY_RETRY_MS = 10 * 60 * 1000;
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
    const t = new Date(deps.now());
    const since = new Date(t.getTime() - RECOVERY_WINDOW_MS);
    const listed = await (async () => {
      try {
        return psp.listUnverified
          ? await psp.listUnverified()
          : { kind: "unknown" as const, code: undefined };
      } catch (err) {
        console.error("payment recovery unVerified lookup failed", { err });
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
          console.error("unverified payment amount mismatch", {
            paymentId: payment.id,
            storedAmountRial: payment.amountRial,
            providerAmountRial: item.amountRial,
          });
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
        console.error("payment recovery Verify failed", { paymentId: payment.id, err });
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
            inArray(payments.status, [
              "redirected",
              "verifying",
              "manual_review",
              "canceled",
              "paid",
            ]),
            or(isNull(payments.nextVerifyAt), lte(payments.nextVerifyAt, t)),
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
              .set({
                status: "failed",
                pspResult: inquiry.code ?? null,
                nextVerifyAt: null,
                updatedAt: t,
              })
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
              nextVerifyAt: new Date(
                t.getTime() + (shouldReview ? MANUAL_REVIEW_RETRY_MS : INQUIRY_RETRY_MS),
              ),
              updatedAt: t,
            })
            .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
          if (shouldReview) reviewed += 1;
        } catch (err) {
          errors += 1;
          console.error("payment recovery Inquiry failed", { paymentId: payment.id, err });
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

  const authorized = async (got: string | undefined) => {
    const expected = await configuredSecret(deps);
    return Boolean(expected && got && secretEquals(got, expected));
  };

  r.post("/internal/payments/relay-auth", (c) => {
    const candidate = c.req.header("x-relay-candidate") || "";
    const expected = env.PROXY_SECRET || "";
    if (!expected || !candidate || !secretEquals(candidate, expected)) return c.body(null, 403);
    return c.body(null, 204);
  });

  const reconcile = async (c: Context<AppEnv>) => {
    if (!(await authorized(c.req.header("x-payment-reconcile-secret")))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const result = await runRecovery();
    return result.success ? c.json(result) : c.json(result, 502);
  };

  r.post("/internal/payments/reconcile", reconcile);
  r.post("/internal/payments/reconcile-unverified", reconcile);
  return r;
}
