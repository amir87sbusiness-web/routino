/** Serves the admin panel at `/admin`. The page itself is the shared
 * `ADMIN_PAGE` string — identical to what the local Fastify backend serves. */
import { Hono } from "hono";
import { html, type AppEnv, type Deps } from "../deps.ts";
import { ADMIN_PAGE } from "../shared/lib/admin-page.ts";
import { withAdminUserDeleteUi } from "../shared/lib/admin-user-delete-ui.ts";
import { withAdminUserListUi } from "../shared/lib/admin-user-list-ui.ts";

const ADMIN_PAGE_WITH_ADMIN_UI = withAdminUserListUi(withAdminUserDeleteUi(ADMIN_PAGE));

export function adminPanelRoutes(_deps: Deps) {
  const r = new Hono<AppEnv>();
  r.get("/admin", (c) => html(c, ADMIN_PAGE_WITH_ADMIN_UI));
  return r;
}
