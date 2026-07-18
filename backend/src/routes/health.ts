import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({ ok: true }));

  /** Readiness: proves the database is actually reachable, not just that the
   * process is up. This is what a load balancer should poll. */
  app.get("/health/ready", async (_req, reply) => {
    try {
      await app.deps.db.execute(sql`select 1`);
      return { ok: true, db: "up" };
    } catch {
      return reply.status(503).send({ ok: false, db: "down" });
    }
  });
};
