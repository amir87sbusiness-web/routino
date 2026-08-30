import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_PAGE } from "../src/lib/admin-page.js";

const overview = {
  alerts: { verifyFailed: 0 },
  users: { total: 42, last24h: 0 },
  activeSubscriptions: 0,
  payments: {
    paidTotal: 0,
    revenueToman: 0,
    revenueTomanLast24h: 0,
    pending: 0,
  },
  otpSentLast24h: 0,
};

const settlePage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("admin page", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the authenticated overview without fetching it a second time", async () => {
    // This catches the old login flow where the successful /overview response
    // only validated the token and showPanel immediately fetched it again.
    const fetch = vi.fn(async (_path: string) => ({
      status: 200,
      ok: true,
      json: async () => overview,
    }));
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        const dialog = (window as { HTMLDialogElement?: { prototype: { showModal: () => void } } })
          .HTMLDialogElement;
        if (dialog) dialog.prototype.showModal = () => undefined;
        Object.assign(window, { fetch, alert: vi.fn(), confirm: vi.fn(() => true) });
      },
    });

    try {
      const document = dom.window.document;
      (document.querySelector("#tok") as { value: string }).value = "admin-token";
      (document.querySelector("#enter") as { click: () => void }).click();
      await settlePage();
      await settlePage();

      expect(fetch.mock.calls.filter(([path]) => path === "/v1/admin/overview")).toHaveLength(1);
      expect(document.querySelector("#ovCards")?.textContent).toContain("۴۲");
    } finally {
      dom.window.close();
    }
  });

  it("shows account history without device or blocking controls", async () => {
    const detail = {
      user: { phone: "989123334444", createdAt: new Date().toISOString() },
      entitlement: { planId: "trial", expiresAt: new Date().toISOString() },
      payments: [],
      grants: [],
    };
    const fetch = vi.fn(async (path: string) => ({
      status: 200,
      ok: true,
      json: async () => (path.includes("/users/") ? detail : overview),
    }));
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        const dialog = (window as { HTMLDialogElement?: { prototype: { showModal: () => void } } })
          .HTMLDialogElement;
        if (dialog) dialog.prototype.showModal = () => undefined;
        Object.assign(window, { fetch, alert: vi.fn(), confirm: vi.fn(() => true) });
      },
    });

    try {
      await (dom.window as unknown as { openUser: (id: string) => Promise<void> }).openUser(
        "user-id",
      );
      expect(dom.window.document.querySelector("#maxDevices")).toBeNull();
      expect(dom.window.document.querySelector("#devicePolicyGo")).toBeNull();
      expect(dom.window.document.querySelector("#resetSwitchGo")).toBeNull();
      expect(dom.window.document.querySelector("#bGo")).toBeNull();
      expect(dom.window.document.querySelector("#userDlg")?.textContent).not.toContain("دستگاه‌ها");
    } finally {
      dom.window.close();
    }
  });
});
