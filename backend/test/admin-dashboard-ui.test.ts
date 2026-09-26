import { describe, expect, it } from "vitest";
import { ADMIN_PAGE } from "../src/lib/admin-page.js";
import { withAdminDashboardUi } from "../src/routes/admin-dashboard-ui.js";

describe("admin dashboard refresh", () => {
  it("adds Sheetra-style calendar ranges and charts without extra dashboard requests", () => {
    const page = withAdminDashboardUi(ADMIN_PAGE);

    expect(page).toContain("نمودار درآمد و فروش");
    expect(page).toContain("کاربران جدید");
    expect(page).toContain('data-analytics-range="today"');
    expect(page).toContain('data-analytics-range="yesterday"');
    expect(page).toContain('data-analytics-range="7"');
    expect(page).toContain('data-analytics-range="30"');
    expect(page).toContain('data-analytics-range="90"');
    expect(page).toContain("۰۰:۰۰ تهران");
    expect(page).toContain("linearGradient");
    expect(page).not.toContain('api("/sales-trend?days="');

    expect(page).toContain('id="tab-users"');
    expect(page).toContain('id="tab-payments"');
    expect(page).toContain('id="tab-plans"');
    expect(page).toContain('id="tab-discounts"');
  });

  it("is a no-op when the expected overview marker is missing", () => {
    const unrelatedPage = "<html><body>admin shell</body></html>";
    expect(withAdminDashboardUi(unrelatedPage)).toBe(unrelatedPage);
  });
});
