import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { rowsOf } from "../db/client.js";
import { runPaymentRecoverySweep } from "../services/payment-recovery.js";

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

  const runSweep = (limit: number) =>
    runPaymentRecoverySweep(db, psp, new Date(app.deps.now()), {
      limit,
      maxConcurrent: env.PSP_PROVIDER_MAX_CONCURRENCY,
      onError: (paymentId, err) =>
        app.log.error({ paymentId, err }, "payment recovery item failed"),
    });

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
    return runSweep(80);
  });
};
