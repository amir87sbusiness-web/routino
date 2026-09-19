/**
 * Serves the admin panel at `/admin`. The base page remains framework-free and
 * shared with Edge; route-local wrappers add owner-only dashboard enhancements
 * without changing the generated shared admin page.
 */
import type { FastifyPluginAsync } from "fastify";
import { ADMIN_PAGE } from "../lib/admin-page.js";
import { withAdminUserDeleteUi } from "../lib/admin-user-delete-ui.js";
import { withAdminUserListUi } from "../lib/admin-user-list-ui.js";
import { unauthorized } from "../plugins/errors.js";
import { ADMIN_SESSION_COOKIE, readCookie, verifyAdminSession } from "../services/admin-auth.js";
import { withAdminDashboardUi } from "./admin-dashboard-ui.js";
import { adminSalesTrend } from "./admin-sales-trend.js";

const ADMIN_PAGE_WITH_ADMIN_UI = withAdminDashboardUi(
  withAdminUserListUi(withAdminUserDeleteUi(ADMIN_PAGE)),
);

export const adminPanelRoutes: FastifyPluginAsync = async (app) => {
  app.get("/admin", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send(ADMIN_PAGE_WITH_ADMIN_UI),
  );

  app.get("/v1/admin/sales-trend", async (req) => {
    const token = readCookie(req.headers.cookie, ADMIN_SESSION_COOKIE);
    if (!token) throw unauthorized("invalid_admin_session", "Admin session is required");
    await verifyAdminSession(app.deps.env, token, new Date(app.deps.now()));

    const query = req.query as { days?: string };
    const days = Number(query.days ?? 30);
    return adminSalesTrend(app.deps.db, new Date(app.deps.now()), days);
  });
};
