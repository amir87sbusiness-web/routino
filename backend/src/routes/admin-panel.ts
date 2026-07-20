/**
 * Serves the admin panel at `/admin`. The page itself lives in
 * `lib/admin-page.ts` (framework-free) so the Supabase Edge Function serves the
 * identical panel — this file is only the Fastify binding.
 */
import type { FastifyPluginAsync } from "fastify";
import { ADMIN_PAGE } from "../lib/admin-page.js";

export const adminPanelRoutes: FastifyPluginAsync = async (app) => {
  app.get("/admin", async (_req, reply) => reply.type("text/html; charset=utf-8").send(ADMIN_PAGE));
};
