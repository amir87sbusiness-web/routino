import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_PAGE } from "../src/lib/admin-page.js";

const overview = {
  alerts: { verifyFailed: 0 },
  users: { total: 42, last24h: 0 },
  trialStarts: 17,
  activeSubscriptions: 0,
  payments: {
    paidTotal: 0,
    revenueToman: 0,
    paidLast24h: 0,
    revenueTomanLast24h: 0,
    pending: 0,
  },
  otpSentLast24h: 0,
  serverTime: "2026-09-01T00:00:00.000Z",
};

const overviewSnapshot = (data = overview) =>
  JSON.stringify({ version: 1, savedAt: 1_788_220_800_000, data });

const settlePage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const sessionStorageOf = (dom: JSDOM) =>
  (
    dom.window as unknown as {
      sessionStorage: { getItem: (key: string) => string | null };
    }
  ).sessionStorage;

describe("admin page", () => {
  afterEach(() => vi.restoreAllMocks());

  it("contains only the phone + OTP login contract, never a browser-stored admin secret", () => {
    expect(ADMIN_PAGE).toContain('name="phone"');
    expect(ADMIN_PAGE).toContain('autocomplete="tel"');
    expect(ADMIN_PAGE).toContain('name="otp"');
    expect(ADMIN_PAGE).toContain('autocomplete="one-time-code"');
    expect(ADMIN_PAGE).not.toContain("ADMIN_TOKEN");
    expect(ADMIN_PAGE).not.toContain("x-admin-token");
    expect(ADMIN_PAGE).not.toContain("localStorage");
  });

  it("enters immediately after OTP and coalesces overview refreshes", async () => {
    let resolveOverview!: (response: {
      status: number;
      ok: boolean;
      json: () => Promise<typeof overview>;
    }) => void;
    const overviewResponse = new Promise<{
      status: number;
      ok: boolean;
      json: () => Promise<typeof overview>;
    }>((resolve) => {
      resolveOverview = resolve;
    });
    const fetch = vi.fn((path: string, _init?: { credentials?: string }) => {
      if (path.endsWith("/auth/session"))
        return Promise.resolve({ status: 401, ok: false, json: async () => ({}) });
      if (path.endsWith("/auth/otp/request"))
        return Promise.resolve({ status: 202, ok: true, json: async () => ({ accepted: true }) });
      if (path.endsWith("/auth/otp/verify"))
        return Promise.resolve({
          status: 200,
          ok: true,
          json: async () => ({ authenticated: true }),
        });
      return overviewResponse;
    });
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
      await settlePage();
      (document.querySelector("#adminPhone") as { value: string }).value = "09120000123";
      (document.querySelector("#enter") as { click: () => void }).click();
      await settlePage();
      expect((document.querySelector("#otpStep") as unknown as { hidden: boolean }).hidden).toBe(
        false,
      );

      (document.querySelector("#adminOtp") as { value: string }).value = "1234";
      (document.querySelector("#enter") as { click: () => void }).click();
      await settlePage();

      expect(
        (document.querySelector("#panel") as { style: { display: string } }).style.display,
      ).toBe("");
      expect(
        (document.querySelector("#login") as { style: { display: string } }).style.display,
      ).toBe("none");
      expect(document.querySelector("#pageStatus")?.textContent).toContain("به‌روزرسانی");
      expect(fetch.mock.calls.filter(([path]) => path === "/v1/admin/overview")).toHaveLength(1);

      const firstRefresh = (
        dom.window as unknown as { loadOverview: () => Promise<void> }
      ).loadOverview();
      const secondRefresh = (
        dom.window as unknown as { loadOverview: () => Promise<void> }
      ).loadOverview();
      expect(fetch.mock.calls.filter(([path]) => path === "/v1/admin/overview")).toHaveLength(1);

      resolveOverview({ status: 200, ok: true, json: async () => overview });
      await Promise.all([firstRefresh, secondRefresh]);
      await settlePage();

      expect(fetch.mock.calls.every(([, init]) => init?.credentials === "same-origin")).toBe(true);
      expect(document.querySelector("#ovCards")?.textContent).toContain("۴۲");
      expect(document.querySelector("#ovCards")?.textContent).toContain("دفعات شروع تریال");
      expect(document.querySelector("#ovCards")?.textContent).toContain("۱۷");
      expect(document.querySelector("#ovCards")?.textContent).toContain("امروز");
      expect(document.querySelector("#ovCards")?.textContent).toContain("کسب‌وکار");
      expect(document.querySelector("#ovCards")?.textContent).toContain("نیاز به توجه");
    } finally {
      dom.window.close();
    }
  });

  it("bounds a stalled overview request without retrying", async () => {
    let overviewCalls = 0;
    let overviewSignal: AbortSignal | undefined;
    const fetch = vi.fn(
      (
        path: string,
        init?: { signal?: AbortSignal },
      ): Promise<{ status: number; ok: boolean; json: () => Promise<object> }> => {
        if (path.endsWith("/auth/session")) {
          return Promise.resolve({
            status: 200,
            ok: true,
            json: async () => ({ authenticated: true }),
          });
        }
        overviewCalls += 1;
        overviewSignal = init?.signal;
        return new Promise((_resolve, reject) => {
          overviewSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      },
    );
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        Object.assign(window, {
          fetch,
          alert: vi.fn(),
          confirm: vi.fn(() => true),
          setTimeout: (callback: () => void) => {
            queueMicrotask(callback);
            return 1;
          },
          clearTimeout: vi.fn(),
        });
      },
    });

    try {
      await settlePage();
      await settlePage();
      expect(overviewSignal?.aborted).toBe(true);
      expect(overviewCalls).toBe(1);
      expect(dom.window.document.querySelector("#pageStatus")?.textContent).toContain("خطا");
    } finally {
      dom.window.close();
    }
  });

  it("renders a same-tab aggregate snapshot only after session validation", async () => {
    let resolveSession!: (response: {
      status: number;
      ok: boolean;
      json: () => Promise<{ authenticated: boolean }>;
    }) => void;
    let resolveOverview!: (response: {
      status: number;
      ok: boolean;
      json: () => Promise<typeof overview>;
    }) => void;
    const sessionResponse = new Promise<{
      status: number;
      ok: boolean;
      json: () => Promise<{ authenticated: boolean }>;
    }>((resolve) => {
      resolveSession = resolve;
    });
    const liveOverview = { ...overview, users: { ...overview.users, total: 43 } };
    const liveResponse = new Promise<{
      status: number;
      ok: boolean;
      json: () => Promise<typeof overview>;
    }>((resolve) => {
      resolveOverview = resolve;
    });
    const fetch = vi.fn((path: string) =>
      path.endsWith("/auth/session") ? sessionResponse : liveResponse,
    );
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        (
          window as { sessionStorage: { setItem: (key: string, value: string) => void } }
        ).sessionStorage.setItem("routino_admin_overview_v1", overviewSnapshot());
        Object.assign(window, { fetch, alert: vi.fn(), confirm: vi.fn(() => true) });
      },
    });

    try {
      expect(dom.window.document.querySelector("#ovCards")?.textContent).not.toContain("۴۲");
      resolveSession({
        status: 200,
        ok: true,
        json: async () => ({ authenticated: true }),
      });
      await settlePage();
      await settlePage();
      expect(dom.window.document.querySelector("#ovCards")?.textContent).toContain("۴۲");
      expect(fetch.mock.calls.filter(([path]) => path === "/v1/admin/overview")).toHaveLength(1);

      resolveOverview({ status: 200, ok: true, json: async () => liveOverview });
      await settlePage();
      await settlePage();
      expect(dom.window.document.querySelector("#ovCards")?.textContent).toContain("۴۳");
      const saved = JSON.parse(
        sessionStorageOf(dom).getItem("routino_admin_overview_v1") || "{}",
      ) as { data?: { users?: { total?: number } } };
      expect(saved.data?.users?.total).toBe(43);
    } finally {
      dom.window.close();
    }
  });

  it("clears the aggregate snapshot when the admin session is invalid", async () => {
    const fetch = vi.fn(async () => ({ status: 401, ok: false, json: async () => ({}) }));
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        (
          window as { sessionStorage: { setItem: (key: string, value: string) => void } }
        ).sessionStorage.setItem("routino_admin_overview_v1", overviewSnapshot());
        Object.assign(window, { fetch, alert: vi.fn(), confirm: vi.fn(() => true) });
      },
    });

    try {
      await settlePage();
      expect(sessionStorageOf(dom).getItem("routino_admin_overview_v1")).toBeNull();
      expect(
        (dom.window.document.querySelector("#login") as { style: { display: string } }).style
          .display,
      ).toBe("");
    } finally {
      dom.window.close();
    }
  });

  it("rejects a malformed aggregate snapshot without rendering its contents", async () => {
    const never = new Promise<never>(() => undefined);
    const fetch = vi.fn((path: string) =>
      path.endsWith("/auth/session")
        ? Promise.resolve({
            status: 200,
            ok: true,
            json: async () => ({ authenticated: true }),
          })
        : never,
    );
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        (
          window as { sessionStorage: { setItem: (key: string, value: string) => void } }
        ).sessionStorage.setItem(
          "routino_admin_overview_v1",
          JSON.stringify({ version: 1, savedAt: Date.now(), data: { phone: "private" } }),
        );
        Object.assign(window, { fetch, alert: vi.fn(), confirm: vi.fn(() => true) });
      },
    });

    try {
      await settlePage();
      await settlePage();
      expect(sessionStorageOf(dom).getItem("routino_admin_overview_v1")).toBeNull();
      expect(dom.window.document.querySelector("#ovCards")?.textContent).not.toContain("private");
    } finally {
      dom.window.close();
    }
  });

  it("clears the aggregate snapshot on logout", async () => {
    const fetch = vi.fn(async (path: string) => ({
      status: path.endsWith("/auth/logout") ? 204 : 200,
      ok: true,
      json: async () => (path.endsWith("/overview") ? overview : { authenticated: true }),
    }));
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        Object.assign(window, { fetch, alert: vi.fn(), confirm: vi.fn(() => true) });
      },
    });

    try {
      await settlePage();
      await settlePage();
      expect(sessionStorageOf(dom).getItem("routino_admin_overview_v1")).not.toBeNull();
      (dom.window.document.querySelector("#logout") as { click: () => void }).click();
      await settlePage();
      expect(sessionStorageOf(dom).getItem("routino_admin_overview_v1")).toBeNull();
    } finally {
      dom.window.close();
    }
  });

  it("refreshes the overview once after creating an account from the panel", async () => {
    const fetch = vi.fn(async (path: string) => {
      if (path.endsWith("/overview")) {
        return { status: 200, ok: true, json: async () => overview };
      }
      if (path.endsWith("/users/set-password")) {
        return {
          status: 200,
          ok: true,
          json: async () => ({ created: true, userId: "new-user", phone: "989120000000" }),
        };
      }
      if (path.includes("/users")) {
        return { status: 200, ok: true, json: async () => ({ users: [] }) };
      }
      return { status: 200, ok: true, json: async () => ({ authenticated: true }) };
    });
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        Object.assign(window, { fetch, alert: vi.fn(), confirm: vi.fn(() => true) });
      },
    });

    try {
      await settlePage();
      await settlePage();
      expect(fetch.mock.calls.filter(([path]) => path === "/v1/admin/overview")).toHaveLength(1);
      (dom.window.document.querySelector("#spPhone") as { value: string }).value = "09120000000";
      (dom.window.document.querySelector("#spPass") as { value: string }).value = "safePass123";
      (dom.window.document.querySelector("#spGo") as { click: () => void }).click();
      await settlePage();
      await settlePage();
      expect(fetch.mock.calls.filter(([path]) => path === "/v1/admin/overview")).toHaveLength(2);
    } finally {
      dom.window.close();
    }
  });

  it("restores the long-lived cookie session and sends CSRF on mutations", async () => {
    const fetch = vi.fn(async (path: string, _init?: { headers?: Record<string, string> }) => ({
      status: 200,
      ok: true,
      json: async () =>
        path.endsWith("/overview") ? overview : { authenticated: true, discount: {} },
    }));
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        (window as { document: { cookie: string } }).document.cookie =
          "routino_admin_csrf=csrf-test-value; Path=/; Secure; SameSite=Strict";
        Object.assign(window, { fetch, alert: vi.fn(), confirm: vi.fn(() => true) });
      },
    });

    try {
      await settlePage();
      await settlePage();
      const document = dom.window.document;
      (document.querySelector("#dCode") as unknown as { value: string }).value = "SAFE30";
      (document.querySelector("#dPercent") as unknown as { value: string }).value = "30";
      (document.querySelector("#dCreate") as unknown as { click(): void }).click();
      await settlePage();
      const mutation = fetch.mock.calls.find(([path]) => path === "/v1/admin/discounts");
      expect(mutation?.[1]?.headers).toMatchObject({ "x-admin-csrf": "csrf-test-value" });
    } finally {
      dom.window.close();
    }
  });

  it("opens cached user details inline from users and payments", async () => {
    const user = {
      id: "user-id",
      phone: "989123334444",
      username: "amir",
      createdAt: "2026-09-01T10:00:00.000Z",
      activeDays: 4,
      lastActiveAt: "2026-09-03T10:30:00.000Z",
      syncRecordCount: 8,
      syncDataBytes: 2048,
      planId: "trial",
      expiresAt: "2026-09-08T10:00:00.000Z",
      subscriptionActive: true,
    };
    const detail = {
      user,
      entitlement: { planId: "trial", expiresAt: user.expiresAt },
      payments: [],
      grants: [],
    };
    const fetch = vi.fn(async (path: string) => {
      let body: object = { authenticated: true };
      if (path.endsWith("/overview")) body = overview;
      else if (path.endsWith("/users")) body = { users: [user] };
      else if (path.endsWith("/users/user-id")) body = detail;
      else if (path.endsWith("/payments")) {
        body = {
          payments: [
            {
              id: "payment-id",
              userId: user.id,
              phone: user.phone,
              username: user.username,
              planId: "m1",
              amountToman: 59000,
              status: "paid",
              createdAt: "2026-09-03T10:00:00.000Z",
            },
          ],
        };
      }
      return { status: 200, ok: true, json: async () => body };
    });
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        Object.assign(window, { fetch, alert: vi.fn(), confirm: vi.fn(() => true) });
      },
    });

    try {
      await settlePage();
      await settlePage();
      const document = dom.window.document;
      (document.querySelector("#tab-button-users") as { click(): void }).click();
      await settlePage();
      await settlePage();
      const userRow = document.querySelector("#uResults .expandable-row") as unknown as {
        click(): void;
        getAttribute(name: string): string | null;
      };
      userRow.click();
      await settlePage();
      await settlePage();
      expect(userRow.getAttribute("aria-expanded")).toBe("true");
      expect(document.querySelector("#uResults .detail-row")?.textContent).toContain("۲ کیلوبایت");

      userRow.click();
      userRow.click();
      await settlePage();
      expect(fetch.mock.calls.filter(([path]) => path === "/v1/admin/users/user-id")).toHaveLength(
        1,
      );

      (document.querySelector("#tab-button-payments") as { click(): void }).click();
      await settlePage();
      await settlePage();
      (document.querySelector("#pResults .expandable-row") as unknown as { click(): void }).click();
      await settlePage();
      expect(document.querySelector("#pResults .detail-row")?.textContent).toContain("amir");
      expect(fetch.mock.calls.filter(([path]) => path === "/v1/admin/users/user-id")).toHaveLength(
        1,
      );
      expect(document.querySelector("#userDlg")).toBeNull();
    } finally {
      dom.window.close();
    }
  });

  it("edits a plan price from its dedicated tab after confirmation", async () => {
    const confirm = vi.fn(() => true);
    const fetch = vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
      if (path.endsWith("/overview")) return { status: 200, ok: true, json: async () => overview };
      if (path.endsWith("/plans/m1") && init?.method === "POST") {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            plan: {
              id: "m1",
              nameFa: "یک‌ماهه",
              nameEn: "1 Month",
              months: 1,
              priceToman: 69000,
              active: true,
            },
          }),
        };
      }
      if (path.endsWith("/plans")) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            plans: [
              {
                id: "m1",
                nameFa: "یک‌ماهه",
                nameEn: "1 Month",
                months: 1,
                priceToman: 59000,
                active: true,
              },
            ],
          }),
        };
      }
      return { status: 200, ok: true, json: async () => ({ authenticated: true }) };
    });
    const dom = new JSDOM(ADMIN_PAGE, {
      runScripts: "dangerously",
      url: "https://admin.routino.test/admin",
      beforeParse(window: object) {
        Object.assign(window, { fetch, alert: vi.fn(), confirm });
      },
    });

    try {
      await settlePage();
      await settlePage();
      const document = dom.window.document;
      (document.querySelector("#tab-button-plans") as { click(): void }).click();
      await settlePage();
      await settlePage();
      const input = document.querySelector("#plansResults input") as unknown as {
        value: string;
        oninput(): void;
      };
      input.value = "69000";
      input.oninput();
      (document.querySelector("#plansResults .plan-save") as unknown as { click(): void }).click();
      await settlePage();
      await settlePage();

      expect(confirm).toHaveBeenCalledOnce();
      const mutation = fetch.mock.calls.find(
        ([path, init]) => path === "/v1/admin/plans/m1" && init?.method === "POST",
      );
      expect(JSON.parse(mutation?.[1]?.body || "{}")).toEqual({ priceToman: 69000 });
      expect(document.querySelector("#plansResults")?.textContent).toContain("۶۹٬۰۰۰");
    } finally {
      dom.window.close();
    }
  });
});
