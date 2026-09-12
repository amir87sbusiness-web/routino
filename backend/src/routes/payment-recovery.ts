import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { rowsOf } from "../db/client.js";
import { payments } from "../db/schema.js";
import { PAYMENT_VERIFY_LEASE_MS, settleOne } from "../services/payment-flow.js";

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
const PROVIDER_FAILURE_GRACE_MS = 20 * 60 * 1000;
const AMBIGUOUS_PROVIDER_CODES = [-51, -55] as const;
const UNVERIFIED_LIMIT = 100;
// pg_net currently gives these cron calls 30 seconds. Leave enough headroom for
// the HTTP response and DB writes rather than letting the infrastructure abort
// a Verify halfway through the recovery state-machine.
const RECONCILE_BUDGET_MS = 27_000;
const VERIFY_START_RESERVE_MS = 21_000;
const ZARINPAL_UNVERIFIED_TIMEOUT_MS = 6_000;

type UnverifiedItem = { authority: string; amountRial: number };
type UnverifiedResult =
  { kind: "ok"; items: UnverifiedItem[] } | { kind: "unknown"; code?: number };

const secretEquals = (a: string, b: string): boolean => {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const providerCode = (body: Record<string, unknown>): number | undefined => {
  const dataCode = record(body.data)?.code;
  if (typeof dataCode === "number" && Number.isInteger(dataCode)) return dataCode;
  const errors = Array.isArray(body.errors) ? record(body.errors[0]) : record(body.errors);
  const errorCode = errors?.code;
  return typeof errorCode === "number" && Number.isInteger(errorCode) ? errorCode : undefined;
};

const providerAmount = (value: unknown): number | undefined => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const canStartVerify = (deadlineMs: number): boolean =>
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

  const fetchUnverified = async (): Promise<UnverifiedResult> => {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      const proxySecret = env.ZARINPAL_PROXY_SECRET.trim();
      if (proxySecret) headers["x-proxy-secret"] = proxySecret;

      const apiBase = env.ZARINPAL_API_BASE.replace(/\/$/, "");
      const res = await fetch(`${apiBase}/pg/v4/payment/unVerified.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({ merchant_id: env.ZARINPAL_MERCHANT }),
        signal: AbortSignal.timeout(ZARINPAL_UNVERIFIED_TIMEOUT_MS),
      });
      const parsed = record((await res.json()) as unknown);
      if (!parsed) return { kind: "unknown" };

      const code = providerCode(parsed);
      if (!res.ok || (code !== undefined && code !== 100)) {
        return { kind: "unknown", code };
      }

      const data = record(parsed.data);
      const authorities = data?.authorities;
      if (!Array.isArray(authorities)) return { kind: "unknown", code };

      const items: UnverifiedItem[] = [];
      for (const raw of authorities) {
        const item = record(raw);
        const authority = typeof item?.authority === "string" ? item.authority.trim() : "";
        const amountRial = providerAmount(item?.amount);
        if (authority && amountRial !== undefined) items.push({ authority, amountRial });
      }
      return { kind: "ok", items };
    } catch {
      return { kind: "unknown" };
    }
  };

  /**
   * `unVerified` is an authoritative provider feed of paid-but-not-verified
   * transactions. Once an authority appears there (and its amount matches our
   * server-priced row), local cooldown/terminal display state must not prevent
   * an immediate Verify. Atomic entitlement grant remains the final guard.
   */
  const prepareAuthoritativeRecovery = async (
    payment: typeof payments.$inferSelect,
    t: Date,
  ): Promise<typeof payments.$inferSelect | undefined> => {
    const staleBefore = new Date(t.getTime() - PAYMENT_VERIFY_LEASE_MS);
    const [prepared] = await db
      .update(payments)
      .set({
        status: "redirected",
        verifyStartedAt: null,
        nextVerifyAt: null,
        updatedAt: t,
      })
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

  const runSweep = async (limit: number) => {
    const deadlineMs = Date.now() + RECONCILE_BUDGET_MS;
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
    let finalized = 0;
    let stillOpen = 0;
    let errors = 0;
    let stoppedEarly = false;

    for (const payment of open) {
      if (!canStartVerify(deadlineMs)) {
        stoppedEarly = true;
        break;
      }
      checked += 1;
      try {
        await settleOne(db, psp, payment, t, env.PSP_PROVIDER_MAX_CONCURRENCY);

        let [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
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

        // Do not poll a genuinely abandoned authority every five minutes for a
        // week. -51/-55 get a short race window; after that the user-facing row
        // becomes terminal. A later authoritative `unVerified` hit can still
        // resurrect and Verify it safely.
        const staleProviderFailure =
          fresh.pspResult !== null &&
          AMBIGUOUS_PROVIDER_CODES.includes(fresh.pspResult as -51 | -55) &&
          t.getTime() - fresh.createdAt.getTime() >= PROVIDER_FAILURE_GRACE_MS;
        if (staleProviderFailure) {
          [fresh] = await db
            .update(payments)
            .set({
              status: "failed",
              verifyStartedAt: null,
              nextVerifyAt: null,
              updatedAt: t,
            })
            .where(and(eq(payments.id, fresh.id), isNull(payments.appliedAt)))
            .returning();
          if (fresh) finalized += 1;
          else stillOpen += 1;
          continue;
        }

        stillOpen += 1;
      } catch (err) {
        errors += 1;
        app.log.error({ paymentId: payment.id, err }, "payment recovery item failed");
      }
    }

    return {
      success: true,
      mode: "sweep",
      checked,
      recovered,
      finalized,
      stillOpen,
      errors,
      stoppedEarly,
    };
  };

  const runUnverified = async () => {
    const deadlineMs = Date.now() + RECONCILE_BUDGET_MS;
    const t = new Date(app.deps.now());
    const since = new Date(t.getTime() - RECOVERY_WINDOW_MS);
    const discovered = await fetchUnverified();
    if (discovered.kind !== "ok") {
      return {
        success: false,
        mode: "unverified",
        error: "provider_unverified_unavailable",
        providerCode: discovered.code ?? null,
      } as const;
    }

    const items = [
      ...new Map(discovered.items.map((item) => [item.authority, item] as const)).values(),
    ].slice(0, UNVERIFIED_LIMIT);
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
        stoppedEarly: false,
      } as const;
    }

    const authorities = items.map((item) => item.authority);
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
      candidates.flatMap((payment) =>
        payment.authority ? [[payment.authority, payment] as const] : [],
      ),
    );

    let matched = 0;
    let checked = 0;
    let recovered = 0;
    let skipped = 0;
    let errors = 0;
    let stoppedEarly = false;

    for (const item of items) {
      const found = byAuthority.get(item.authority);
      if (!found) {
        skipped += 1;
        continue;
      }
      matched += 1;

      // Provider discovery is never enough to grant by itself. The exact Rial
      // amount must match our immutable server-priced row, then normal Verify
      // must still return 100/101 before entitlement can be granted.
      if (found.amountRial !== item.amountRial) {
        skipped += 1;
        app.log.error(
          {
            paymentId: found.id,
            authority: item.authority,
            storedAmountRial: found.amountRial,
            providerAmountRial: item.amountRial,
          },
          "unverified payment amount mismatch",
        );
        continue;
      }

      if (!canStartVerify(deadlineMs)) {
        stoppedEarly = true;
        break;
      }

      try {
        const payment = await prepareAuthoritativeRecovery(found, t);
        if (!payment) {
          skipped += 1;
          continue;
        }
        checked += 1;
        await settleOne(db, psp, payment, t, env.PSP_PROVIDER_MAX_CONCURRENCY);
        const [fresh] = await db
          .select()
          .from(payments)
          .where(eq(payments.id, payment.id))
          .limit(1);
        if (fresh?.appliedAt || fresh?.status === "paid") recovered += 1;
      } catch (err) {
        errors += 1;
        app.log.error({ paymentId: found.id, err }, "unverified payment recovery failed");
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
    const result = await runUnverified();
    return result.success ? result : reply.code(502).send(result);
  });
};
