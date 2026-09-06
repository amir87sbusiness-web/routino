import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDb, type Db, type Subscription } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const authApi = vi.hoisted(() => ({ entitlementToSubscription: vi.fn(), startTrial: vi.fn() }));
const paymentsApi = vi.hoisted(() => ({ fetchPlans: vi.fn() }));
const navigate = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn() }));
const app = vi.hoisted(() => ({
  db: null as Db | null,
  lang: "fa" as "fa" | "en",
  applyEntitlement: vi.fn((subscription: Subscription) => {
    if (!app.db) return;
    app.db = { ...app.db, subscription, meta: { ...app.db.meta, tampered: false } };
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
}));
vi.mock("@/lib/api/auth", () => authApi);
vi.mock("@/lib/api/payments", () => paymentsApi);
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({
    db: app.db,
    applyEntitlement: app.applyEntitlement,
    t: (fa: string, en: string) => (app.lang === "fa" ? fa : en),
    lang: app.lang,
  }),
}));
vi.mock("sonner", () => ({ toast }));

import { Route } from "./activation";

const ActivationPage = (Route as unknown as { component: () => React.ReactNode }).component;
const trialEntitlement = {
  status: "active" as const,
  planId: "trial",
  expiresAt: "2027-08-28T00:00:00.000Z",
  issuedAt: "2026-08-21T00:00:00.000Z",
};

function byButtonText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.click());
}

describe("ActivationPage", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    app.lang = "fa";
    app.db = {
      ...defaultDb([]),
      auth: { userId: "user-1", phone: "989123334444", verifiedAt: 1 },
      habits: [{
        id: "existing-habit", name: "آب", categoryId: "health", type: "binary", target: 1,
        schedule: { kind: "daily" }, monthlyGoal: null, reminderTime: null, createdAt: 1,
      }],
      meta: { ...defaultDb([]).meta, legacyEntitlementMigrationResolved: true },
    };
    app.applyEntitlement.mockClear();
    authApi.startTrial.mockReset().mockResolvedValue({ entitlement: trialEntitlement, started: true });
    authApi.entitlementToSubscription.mockReset().mockReturnValue({
      planId: "trial", startedAt: 1, expiresAt: Date.parse(trialEntitlement.expiresAt), trial: true,
    });
    paymentsApi.fetchPlans.mockReset().mockResolvedValue({
      plans: [
        { id: "m1", nameFa: "یک‌ماهه", nameEn: "Monthly", months: 1, price: 74000 },
        { id: "m3", nameFa: "سه‌ماهه", nameEn: "3 months", months: 3, price: 196000 },
      ],
      offer: null,
    });
    navigate.mockReset();
    toast.error.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<ActivationPage />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("does not start the trial or load prices merely by opening the page", () => {
    expect(authApi.startTrial).not.toHaveBeenCalled();
    expect(paymentsApi.fetchPlans).not.toHaveBeenCalled();
  });

  it("loads and shows current server prices only when plan details are opened", async () => {
    const details = host.querySelector("details")!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    expect(paymentsApi.fetchPlans).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("یک‌ماهه");
    expect(host.textContent).toContain("۷۴,۰۰۰ تومان");
    expect(host.textContent).toContain("۱۹۶,۰۰۰ تومان");
  });

  it("uses the language already chosen in onboarding", async () => {
    app.lang = "en";
    await act(async () => root.render(<ActivationPage />));

    expect(host.textContent).toContain("Try a week with Routino");
    expect(host.textContent).toContain("Start free");
    expect(host.textContent).not.toContain("هفت روز با روتینو پیش برو");
  });

  it("starts once, activates the server trial, preserves habits, and routes home", async () => {
    const habitsBefore = app.db!.habits;
    const button = byButtonText(host, "شروع رایگان");
    await act(async () => {
      button.click();
      button.click();
    });

    expect(authApi.startTrial).toHaveBeenCalledTimes(1);
    expect(app.applyEntitlement).toHaveBeenCalledTimes(1);
    expect(app.applyEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ planId: "trial", trial: true }),
    );
    expect(app.db?.habits).toEqual(habitsBefore);
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("keeps the page usable for retry when trial activation temporarily fails", async () => {
    authApi.startTrial.mockRejectedValueOnce(new Error("offline"));
    await click(byButtonText(host, "شروع رایگان"));

    expect(app.db?.subscription).toBeNull();
    expect(host.textContent).toContain("فعلاً شروع نشد؛ دوباره تلاش کن.");

    await click(byButtonText(host, "تلاش دوباره"));
    expect(authApi.startTrial).toHaveBeenCalledTimes(2);
    expect(app.db?.subscription?.trial).toBe(true);
  });

  it("rejects a non-trial entitlement returned by the server", async () => {
    authApi.startTrial.mockResolvedValueOnce({
      started: false, entitlement: { ...trialEntitlement, planId: "m1" },
    });
    authApi.entitlementToSubscription.mockReturnValueOnce({
      planId: "m1", startedAt: 1, expiresAt: Date.parse(trialEntitlement.expiresAt), trial: false,
    });

    await click(byButtonText(host, "شروع رایگان"));

    expect(app.applyEntitlement).not.toHaveBeenCalled();
    expect(app.db?.subscription).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
