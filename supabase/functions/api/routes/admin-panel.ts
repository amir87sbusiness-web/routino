/** Serves the admin panel at `/admin` and the dashboard-only sales trend feed. */
import { Hono } from "hono";
import { html, type AppEnv, type Deps } from "../deps.ts";
import { ADMIN_PAGE } from "../shared/lib/admin-page.ts";
import { withAdminUserDeleteUi } from "../shared/lib/admin-user-delete-ui.ts";
import { withAdminUserListUi } from "../shared/lib/admin-user-list-ui.ts";
import { unauthorized } from "../shared/lib/http-errors.ts";
import {
  ADMIN_SESSION_COOKIE,
  readCookie,
  verifyAdminSession,
} from "../shared/services/admin-auth.ts";
import { withAdminDashboardUi } from "./admin-dashboard-ui.ts";
import { adminSalesTrend } from "./admin-sales-trend.ts";

const ADMIN_PAGE_WITH_ADMIN_UI = withAdminDashboardUi(
  withAdminUserListUi(withAdminUserDeleteUi(ADMIN_PAGE)),
);

export function adminPanelRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.get("/admin", (c) => html(c, ADMIN_PAGE_WITH_ADMIN_UI));

  r.get("/v1/admin/sales-trend", async (c) => {
    const token = readCookie(c.req.header("cookie"), ADMIN_SESSION_COOKIE);
    if (!token) throw unauthorized("invalid_admin_session", "Admin session is required");
    await verifyAdminSession(deps.env, token, new Date(deps.now()));

    const days = Number(c.req.query("days") ?? 30);
    return c.json(await adminSalesTrend(deps.db, new Date(deps.now()), days));
  });

  return r;
}
