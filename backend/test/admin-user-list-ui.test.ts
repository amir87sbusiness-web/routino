import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_PAGE } from "../src/lib/admin-page.js";
import { withAdminUserDeleteUi } from "../src/lib/admin-user-delete-ui.js";
import { withAdminUserListUi } from "../src/lib/admin-user-list-ui.js";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const overview = {
  alerts: { verifyFailed: 0 },
  users: { total: 205, last24h: 1 },
  trialStarts: 3,
  activeSubscriptions: 2,
  payments: {
    paidTotal: 1,
    revenueToman: 59_000,
    paidLast24h: 0,
    revenueTomanLast24h: 0,
    pending: 0,
  },
  otpSentLast24h: 0,
  serverTime: "2026-09-11T12:00:00.000Z",
};

const sampleUser = {
  id: "00000000-0000-4000-8000-000000000001",
  phone: "989121234567",
  username: "amir",
  createdAt: "2026-09-10T09:00:00.000Z",
  activeDays: 12,
  lastActiveAt: "2026-09-11T08:00:00.000Z",
  syncRecordCount: 55,
  syncDataBytes: 2_097_152,
  planId: "m1",
  expiresAt: "2026-10-11T08:00:00.000Z",
  subscriptionActive: true,
  subscriptionStatus: "active",
};

describe("admin user list UI", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders 100-row cursor navigation and sends sorting/filtering to the server", async () => {
    const userUrls: string[] = [];
    const fetch = vi.fn(async (path: string) => {
      if (path.endsWith("/auth/session")) {
        return { status: 200, ok: true, json: async () => ({ authenticated: true }) };
      }
      if (path.endsWith("/overview")) {
        return { status: 200, ok: true, json: async () => overview };
      }
      if (path.includes("/users?")) {
        userUrls.push(path);
        const url = new URL(path, "https://admin.routino.test");
        const cursor = url.searchParams.get("cursor");
        return {
          status: 200,
          ok: true,
          json: async () => ({
            users: [sampleUser],
            pagination: {
              pageSize: 100,
              hasNext: cursor !== "cursor-two",
              nextCursor:
                cursor === "cursor-one"
                  ? "cursor-two"
                  : cursor === "cursor-two"
                    ? null
                    : "cursor-one",
            },
            sort: {
              key: url.searchParams.get("sort") || "createdAt",
              direction: url.searchParams.get("direction") || "desc",
            },
          }),
        };
      }
      return { status: 200, ok: true, json: async () => ({}) };
    });

    const page = withAdminUserListUi(withAdminUserDeleteUi(ADMIN_PAGE));
    const dom = new JSDOM(page, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        Object.assign(window, { fetch, alert: vi.fn(), confirm: vi.fn(() => true) });
      },
    });

    try {
      await settle();
      await settle();
      const document = dom.window.document;
      (document.querySelector("#tab-button-users") as unknown as { click: () => void }).click();
      await settle();
      await settle();

      expect(document.querySelector("#uFilterToggle")).not.toBeNull();
      expect(document.querySelector("#uResults")?.textContent).toContain("ثبت‌نام");
      expect(document.querySelector("#uResults")?.textContent).toContain("صفحه ۱");
      expect(userUrls.at(-1)).not.toContain("cursor=");
      expect(userUrls.at(-1)).toContain("limit=100");
      expect(userUrls.at(-1)).toContain("sort=createdAt");
      expect(userUrls.at(-1)).toContain("direction=desc");

      (
        document.querySelector('[data-user-nav="next"]') as unknown as { click: () => void }
      ).click();
      await settle();
      await settle();
      expect(
        new URL(userUrls.at(-1)!, "https://admin.routino.test").searchParams.get("cursor"),
      ).toBe("cursor-one");
      expect(document.querySelector("#uResults")?.textContent).toContain("صفحه ۲");

      (
        document.querySelector('[data-user-nav="previous"]') as unknown as { click: () => void }
      ).click();
      await settle();
      await settle();
      expect(
        new URL(userUrls.at(-1)!, "https://admin.routino.test").searchParams.get("cursor"),
      ).toBeNull();
      expect(document.querySelector("#uResults")?.textContent).toContain("صفحه ۱");

      (
        document.querySelector('[data-user-sort="activeDays"]') as unknown as { click: () => void }
      ).click();
      await settle();
      await settle();
      const sorted = new URL(userUrls.at(-1)!, "https://admin.routino.test");
      expect(sorted.searchParams.get("cursor")).toBeNull();
      expect(sorted.searchParams.get("sort")).toBe("activeDays");
      expect(sorted.searchParams.get("direction")).toBe("desc");

      (
        document.querySelector('[data-user-sort="activeDays"]') as unknown as { click: () => void }
      ).click();
      await settle();
      await settle();
      expect(
        new URL(userUrls.at(-1)!, "https://admin.routino.test").searchParams.get("direction"),
      ).toBe("asc");

      (document.querySelector("#uFilterToggle") as unknown as { click: () => void }).click();
      (document.querySelector("#uSubscription") as unknown as { value: string }).value = "active";
      (document.querySelector("#uMinActive") as unknown as { value: string }).value = "5";
      (document.querySelector("#uMinData") as unknown as { value: string }).value = "1.5";
      (document.querySelector("#uMaxData") as unknown as { value: string }).value = "4";
      (document.querySelector("#uRegisteredFrom") as unknown as { value: string }).value =
        "2026-09-01";
      (document.querySelector("#uApplyFilters") as unknown as { click: () => void }).click();
      await settle();
      await settle();

      const filtered = new URL(userUrls.at(-1)!, "https://admin.routino.test");
      expect(filtered.searchParams.get("subscription")).toBe("active");
      expect(filtered.searchParams.get("minActiveDays")).toBe("5");
      expect(filtered.searchParams.get("minDataBytes")).toBe(String(Math.round(1.5 * 1024 * 1024)));
      expect(filtered.searchParams.get("maxDataBytes")).toBe(String(4 * 1024 * 1024));
      expect(filtered.searchParams.get("registeredFrom")).toBe(
        new Date("2026-09-01T00:00:00").toISOString(),
      );
      expect(filtered.searchParams.get("cursor")).toBeNull();
    } finally {
      dom.window.close();
    }
  });
});
