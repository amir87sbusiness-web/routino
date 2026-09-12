import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
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
const AMBIGUOUS_PROVIDER_CODES = [-51, -55] as const;
const UNVERIFIED_LIMIT = 100;
const ZARINPAL_TIMEOUT_MS = 20_000;

type UnverifiedItem = { authority: string; amountRial: number };
type UnverifiedResult =
  | { kind: "ok"; items: UnverifiedItem[] }
  | { kind: "unknown"; code?: number };

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
        signal: AbortSignal.timeout(ZARINPAL_TIMEOUT_MS),
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
        const authority = item?.authority;
        const amount = item?.amount;
        if (
          typeof authority === "string" &&
          authority.length > 0 &&
          typeof amount === "number" &&
          Number.isSafeInteger(amount) &&
          amount > 0
        ) {
          items.push({ authority, amountRial: amount });
        }
      }
      return { kind: "ok", items };
    } catch {
      return { kind: "unknown" };
    }
  };

  const reopenAmbiguousFailure = async (payment: typeof payments.$inferSelect, t: Date) => {
    if (
      payment.status !== "failed" ||
      payment.pspResult === null ||
      !AMBIGUOUS_PROVIDER_CODES.includes(payment.pspResult as -51 | -55)
    ) {
      return payment;
    }
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
    return reopened ?? payment;
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

    for (const row of open) {
      checked += 1;
      try {
        const payment = await reopenAmbiguousFailure(row, t);
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
        stillOpen += 1;
      } catch (err) {
        errors += 1;
        console.error("payment recovery item failed", { paymentId: row.id, err });
      }
    }

    return { success: true, mode: "sweep", checked, recovered, finalized, stillOpen, errors };
  };

  const runUnverified = async () => {
    const t = new Date(deps.now());
    const since = new Date(t.getTime() - RECOVERY_WINDOW_MS);
    const discovered = await fetchUnverified();
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
      const found = byAuthority.get(item.authority);
      if (!found) {
        skipped += 1;
        continue;
      }
      matched += 1;
      if (found.amountRial !== item.amountRial) {
        skipped += 1;
        console.error("unverified payment amount mismatch", {
          paymentId: found.id,
          authority: item.authority,
          storedAmountRial: found.amountRial,
          providerAmountRial: item.amountRial,
        });
        continue;
      }
      if (found.status === "canceled" || found.status === "verify_failed") {
        skipped += 1;
        continue;
      }
      if (
        found.status === "failed" &&
        !(
          found.pspResult !== null &&
          AMBIGUOUS_PROVIDER_CODES.includes(found.pspResult as -51 | -55)
        )
      ) {
        skipped += 1;
        continue;
      }

      try {
        const payment = await reopenAmbiguousFailure(found, t);
        checked += 1;
        await settleOne(db, psp, payment, t, env.PSP_PROVIDER_MAX_CONCURRENCY);
        const [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
        if (fresh?.appliedAt || fresh?.status === "paid") recovered += 1;
      } catch (err) {
        errors += 1;
        console.error("unverified payment recovery failed", { paymentId: found.id, err });
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
    return c.json(await runUnverified());
  });

  return r;
}
