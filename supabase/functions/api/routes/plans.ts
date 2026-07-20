/** Public plan list. Mirrors backend/src/routes/plans.ts. */
import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps.ts";
import { activePlans } from "../shared/services/pricing.ts";

export function planRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  /** Public. Replaces the `PLANS` constant bundled into the client, so prices
   * can change without shipping an app update. */
  r.get("/plans", async (c) => {
    const rows = await activePlans(deps.db);
    return c.json({
      plans: rows.map((p) => ({
        id: p.id,
        nameFa: p.nameFa,
        nameEn: p.nameEn,
        months: p.months,
        price: p.priceToman, // Toman, matching the existing client `Plan` shape
      })),
      offer: null as null | { label: string; percent: number; until: number },
    });
  });

  return r;
}
