import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
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
const AMBIGUOUS_PROVIDER_CODES = [-51, -55] as const;
const UNVERIFIED_LIMIT = 100;

const secretEquals = (a: string, b: string): boolean => {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
};

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
          or(
            inArray(payments.status, [...RECOVERABLE_STATUSES]),
            and(
              eq(payments.status, "failed"),
              inArray(payments.pspResult, [...AMBIGUOUS_PROVIDER_CODES]),
            ),
          ),
          or(isNull(payments.nextVerifyAt), lte(payments.nextVerifyAt, t)),
        ),
      )
      .orderBy(asc(payments.createdAt))
      .limit(limit);

    let checked = 0;
    let recovered = 0;
    let finalized = 0;
    let stillOpen = 0;
    let errors = 0;

    for (let payment of open) {
      checked += 1;
      try {
        // Older code permanently marked -51/-55 as failed after twenty minutes.
        // Those codes are intentionally classified as ambiguous by the adapter,
        // so reopen only that historical subset before retrying. Definitive
        // provider failures remain terminal.
        if (
          payment.status === "failed" &&
          payment.pspResult !== null &&
          AMBIGUOUS_PROVIDER_CODES.includes(payment.pspResult as -51 | -55)
        ) {
          const [reopened] = await db
            .update(payments)
            .set({
              status: "redirected",
              verifyStartedAt: null,
              nextVerifyAt: null,
              updatedAt: t,
            })
            .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)))
            .returning();
          if (!reopened) {
            stillOpen += 1;
            continue;
          }
          payment = reopened;
        }

        await settleOne(db, psp, payment, t, env.PSP_PROVIDER_MAX_CONCURRENCY);

        const [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        if (!fresh) {
          errors += 1;
          continue;
        }
        if (fresh.appliedAt || fresh.status === "paid") {
          recovered += 1;
          continue;
        }
        if (["failed", "canceled", "verify_failed"].includes(fresh.status)) {
          finalized += 1;
          continue;
        }

        // Ambiguous provider answers remain open and use payment-flow's stored
        // exponential backoff. Do not turn them into a false terminal failure.
        stillOpen += 1;
      } catch (err) {
        errors += 1;
        app.log.error({ paymentId: payment.id, err }, "payment recovery item failed");
      }
    }

    return { success: true, mode: "sweep", checked, recovered, finalized, stillOpen, errors };
  };

  const runUnverified = async () => {
    if (!psp.listUnverified) {
      return { success: false, mode: "unverified", error: "provider_unverified_unsupported" };
    }

    const t = new Date(app.deps.now());
    const since = new Date(t.getTime() - RECOVERY_WINDOW_MS);
    const discovered = await psp.listUnverified();
    if (discovered.kind !== "ok") {
      return {
        success: false,
        mode: "unverified",
        error: "provider_unverified_unavailable",
        providerCode: discovered.code ?? null,
      };
    }

    const items = discovered.items.slice(0, UNVERIFIED_LIMIT);
    if (items.length === 0) {
      return {
        success: true,
        mode: "unverified",
        discovered: 0,
        matched: 0,
        checked: 0,
        recovered: 0,
        skipped: 0,
        errors: 0,
      };
    }

    const authorities = [...new Set(items.map((item) => item.authority))];
    const candidates = await db
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
      candidates.flatMap((payment) => (payment.authority ? [[payment.authority, payment] as const] : [])),
    );

    let matched = 0;
    let checked = 0;
    let recovered = 0;
    let skipped = 0;
    let errors = 0;

    for (const item of items) {
      let payment = byAuthority.get(item.authority);
      if (!payment) {
        skipped += 1;
        continue;
      }
      matched += 1;

      // Amount equality is mandatory before any verification/grant. The PSP feed
      // is discovery only; our persisted server-priced payment remains canonical.
      if (payment.amountRial !== item.amountRial) {
        skipped += 1;
        app.log.error(
          {
            paymentId: payment.id,
            authority: item.authority,
            storedAmountRial: payment.amountRial,
            providerAmountRial: item.amountRial,
          },
          "unverified payment amount mismatch",
        );
        continue;
      }
      if (payment.status === "canceled" || payment.status === "verify_failed") {
        skipped += 1;
        continue;
      }
      if (
        payment.status === "failed" &&
        !(
          payment.pspResult !== null &&
          AMBIGUOUS_PROVIDER_CODES.includes(payment.pspResult as -51 | -55)
        )
      ) {
        skipped += 1;
        continue;
      }

      try {
        if (payment.status === "failed") {
          const [reopened] = await db
            .update(payments)
            .set({
              status: "redirected",
              verifyStartedAt: null,
              nextVerifyAt: null,
              updatedAt: t,
            })
            .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)))
            .returning();
          if (!reopened) {
            skipped += 1;
            continue;
          }
          payment = reopened;
        }

        checked += 1;
        await settleOne(db, psp, payment, t, env.PSP_PROVIDER_MAX_CONCURRENCY);
        const [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        if (fresh?.appliedAt || fresh?.status === "paid") recovered += 1;
      } catch (err) {
        errors += 1;
        app.log.error({ paymentId: payment.id, err }, "unverified payment recovery failed");
      }
    }

    return {
      success: true,
      mode: "unverified",
      discovered: items.length,
      matched,
      checked,
      recovered,
      skipped,
      errors,
    };
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

  app.post("/internal/payments/reconcile", async (req, reply) => {
    if (!(await authorize(req))) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return runSweep(30);
  });

  app.post("/internal/payments/reconcile-unverified", async (req, reply) => {
    if (!(await authorize(req))) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return runUnverified();
  });
};
