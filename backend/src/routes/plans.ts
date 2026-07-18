import type { FastifyPluginAsync } from "fastify";
import { activePlans } from "../services/pricing.js";

export const planRoutes: FastifyPluginAsync = async (app) => {
  /** Public. Replaces the `PLANS` constant bundled into the client, so prices
   * can change without shipping an app update. */
  app.get("/plans", async () => {
    const rows = await activePlans(app.deps.db);
    return {
      plans: rows.map((p) => ({
        id: p.id,
        nameFa: p.nameFa,
        nameEn: p.nameEn,
        months: p.months,
        price: p.priceToman, // Toman, matching the existing client `Plan` shape
      })),
      offer: null as null | { label: string; percent: number; until: number },
    };
  });
};
