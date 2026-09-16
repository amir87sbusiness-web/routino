import { describe, expect, it } from "vitest";
import { ADMIN_PAGE } from "../src/lib/admin-page.js";
import { withAdminDashboardUi } from "../src/routes/admin-dashboard-ui.js";

describe("admin dashboard refresh", () => {
  it("adds the daily new-purchase vs renewal chart without removing admin sections", () => {
    const page = withAdminDashboardUi(ADMIN_PAGE);

    expect(page).toContain("روند خرید روزانه");
    expect(page).toContain("اولین خرید هر کاربر در برابر تمدیدهای بعدی");
    expect(page).toContain('data-sales-days="7"');
    expect(page).toContain('data-sales-days="30"');
    expect(page).toContain('data-sales-days="90"');
    expect(page).toContain("stroke:#16a34a");
    expect(page).toContain("stroke:#7c3aed");
    expect(page).toContain('api("/sales-trend?days=" + selectedDays)');

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
