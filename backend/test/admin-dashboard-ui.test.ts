import { describe, expect, it } from "vitest";
import { ADMIN_PAGE } from "../src/lib/admin-page.js";
import { withAdminDashboardUi } from "../src/routes/admin-dashboard-ui.js";

describe("admin dashboard refresh", () => {
  it("adds Sheetra-style interactive analytics with bounded conversion and renewal metrics", () => {
    const page = withAdminDashboardUi(ADMIN_PAGE);

    expect(page).toContain("داشبورد فروش و رشد");\n    expect(page).toContain("فروش و درآمد");
    expect(page).toContain("رشد و تبدیل روزانه");
    expect(page).toContain('data-analytics-range="today"');
    expect(page).toContain('data-analytics-range="yesterday"');
    expect(page).toContain('data-analytics-range="7"');
    expect(page).toContain('data-analytics-range="30"');
    expect(page).toContain('data-analytics-range="90"');
    expect(page).toContain("۰۰:۰۰ تهران");
    expect(page).toContain("linearGradient");
    expect(page).toContain("خرید مجدد");
    expect(page).toContain("سهم خرید مجدد از فروش");
    expect(page).toContain('api("/sales-trend?days=90")');

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
