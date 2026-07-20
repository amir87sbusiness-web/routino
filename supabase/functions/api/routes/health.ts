/** Health routes. `/health/ready` proves the database is reachable, not just
 * that the function boots — what an uptime monitor should poll. */
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps.ts";

export function healthRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  r.get("/health", (c) => c.json({ ok: true }));

  r.get("/health/ready", async (c) => {
    try {
      await deps.db.execute(sql`select 1`);
      return c.json({ ok: true, db: "up" });
    } catch {
      return c.json({ ok: false, db: "down" }, 503);
    }
  });

  return r;
}
