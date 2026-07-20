/** Serves the admin panel at `/admin`. The page itself is the shared
 * `ADMIN_PAGE` string — identical to what the local Fastify backend serves. */
import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps.ts";
import { ADMIN_PAGE } from "../shared/lib/admin-page.ts";

export function adminPanelRoutes(_deps: Deps) {
  const r = new Hono<AppEnv>();
  r.get("/admin", (c) => c.html(ADMIN_PAGE));
  return r;
}
