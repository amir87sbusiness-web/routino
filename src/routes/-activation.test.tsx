import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearActivationSelection,
  loadActivationSelection,
  saveActivationSelection,
} from "@/lib/activation-selection";
import { todayKey } from "@/lib/dates";
import { dueHabitsOn } from "@/lib/logic";
import { DEFAULT_CATEGORIES } from "@/lib/presets";
import { defaultDb, type Category, type Db, type Habit, type Subscription } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.hoisted(() => ({
  entitlementToSubscription: vi.fn(),
  startTrial: vi.fn(),
}));
const native = vi.hoisted(() => ({
  checkNativeExactAlarmSetting: vi.fn(),
  isNativeRuntime: vi.fn(),
  requestNativeExactAlarmSetting: vi.fn(),
  requestNotificationPermission: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }));
const app = vi.hoisted(() => ({ db: null as Db | null, update: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
}));
vi.mock("@/lib/api/auth", () => api);
vi.mock("@/lib/native-notifications", () => native);
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({
    db: app.db,
    update: (fn: (db: Db) => Db) => {
      if (app.db) app.db = fn(app.db);
      app.update(fn);
    },
    updatePreferences: (patch: Partial<Db["settings"]>) => {
      if (app.db) app.db = { ...app.db, settings: { ...app.db.settings, ...patch } };
    },
    commitTrialActivation: (
      subscription: Subscription,
      habit: Habit | null,
      category?: Category,
    ) => {
      if (!app.db) return;
      app.db = {
        ...app.db,
        subscription,
        meta: { ...app.db.meta, tampered: false },
        categories:
          category && !app.db.categories.some((existing) => existing.id === category.id)
            ? [...app.db.categories, category]
            : app.db.categories,
        habits: habit ? [...app.db.habits, habit] : app.db.habits,
      };
    },
    t: (fa: string) => fa,
    lang: "fa",
  }),
}));
vi.mock("sonner", () => ({ toast }));

import { Route } from "./activation";

const ActivationPage = (Route as unknown as { component: () => React.ReactNode }).component;

async function click(button: HTMLButtonElement) {
  await act(async () => button.click());
}

function change(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const trialEntitlement = {
  status: "active" as const,
  planId: "trial",
  expiresAt: "2026-08-28T00:00:00.000Z",
  issuedAt: "2026-08-21T00:00:00.000Z",
};

describe("ActivationPage", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    localStorage.clear();
    clearActivationSelection();
    app.db = {
      ...defaultDb(DEFAULT_CATEGORIES),
      auth: { userId: "user-1", phone: "989123334444", verifiedAt: 1 },
      meta: { ...defaultDb([]).meta, legacyEntitlementMigrationResolved: true },
    };
    app.update.mockReset();
    api.startTrial.mockReset().mockResolvedValue({ entitlement: trialEntitlement, started: true });
    api.entitlementToSubscription.mockReset().mockReturnValue({
      planId: "trial",
      startedAt: 1,
      expiresAt: Date.parse(trialEntitlement.expiresAt),
      trial: true,
    });
    native.isNativeRuntime.mockReset().mockReturnValue(false);
    native.requestNotificationPermission.mockReset().mockResolvedValue(true);
    native.checkNativeExactAlarmSetting.mockReset().mockResolvedValue("not-android");
    native.requestNativeExactAlarmSetting.mockReset();
    navigate.mockReset();
    toast.error.mockReset();
    toast.warning.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<ActivationPage />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("does not start a trial merely by opening the activation screen", () => {
    expect(api.startTrial).not.toHaveBeenCalled();
  });

  it("cannot finish without an existing or prepared valid habit", () => {
    const finish = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "شروع ۷ روز رایگان",
    )!;

    expect(finish.disabled).toBe(true);
    expect(api.startTrial).not.toHaveBeenCalled();
  });

  it("starts from a curated preset through the real habit model and routes to Today", async () => {
    await click(
      [...host.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("مطالعهٔ درسی"),
      )!,
    );
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "شروع ۷ روز رایگان",
      )!,
    );

    expect(api.startTrial).toHaveBeenCalledTimes(1);
    expect(app.db?.subscription).toMatchObject({ planId: "trial", trial: true });
    expect(app.db?.habits).toEqual([
      expect.objectContaining({
        name: "مطالعهٔ درسی",
        categoryId: "study",
        target: 60,
        unitKind: "time",
      }),
    ]);
    expect(dueHabitsOn(app.db!, todayKey(), "jalali")).toHaveLength(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("commits a custom habit through the existing form instead of a second model", async () => {
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "ساخت عادت دلخواه",
      )!,
    );
    const name = document.querySelector<HTMLInputElement>(
      'input[placeholder="مثلاً: ۲۰ دقیقه مطالعه"]',
    )!;
    await act(async () => change(name, "پیاده‌روی عصر"));
    await click(
      [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("اضافه کردن"),
      )!,
    );
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "شروع ۷ روز رایگان",
      )!,
    );

    expect(app.db?.habits).toEqual([
      expect.objectContaining({ name: "پیاده‌روی عصر", type: "binary", categoryId: "morning" }),
    ]);
  });

  it("keeps the prepared selection and creates no local trial when the server is unavailable", async () => {
    api.startTrial.mockRejectedValueOnce(new Error("offline"));
    await click(
      [...host.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("نوشیدن ۸ لیوان آب"),
      )!,
    );
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "شروع ۷ روز رایگان",
      )!,
    );

    expect(app.db?.subscription).toBeNull();
    expect(app.db?.habits).toEqual([]);
    expect(loadActivationSelection()).toMatchObject({ kind: "draft" });
    expect(toast.error).toHaveBeenCalled();
  });

  it("allows an existing active habit without creating a duplicate", async () => {
    app.db = {
      ...app.db!,
      habits: [
        {
          id: "already-here",
          name: "Habit already prepared",
          categoryId: "health",
          type: "binary",
          target: 1,
          schedule: { kind: "daily" },
          monthlyGoal: null,
          reminderTime: null,
          createdAt: 1,
        },
      ],
    };
    await act(async () => root.render(<ActivationPage />));
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "شروع ۷ روز رایگان",
      )!,
    );

    expect(app.db?.habits).toHaveLength(1);
    expect(app.db?.habits[0]?.id).toBe("already-here");
  });

  it("keeps the successful habit and trial when notification permission is denied", async () => {
    native.requestNotificationPermission.mockResolvedValueOnce(false);
    saveActivationSelection({
      kind: "draft",
      draft: {
        name: "Reminder habit",
        categoryId: "health",
        type: "binary",
        target: 1,
        unit: "",
        unitKind: "count",
        scheduleKind: "weekdays",
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        monthlyGoal: "30",
        reminderTime: "09:00",
      },
    });
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<ActivationPage />));
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "شروع ۷ روز رایگان",
      )!,
    );

    expect(app.db?.subscription?.trial).toBe(true);
    expect(app.db?.habits).toEqual([expect.objectContaining({ reminderTime: "09:00" })]);
    expect(native.requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalled();
  });

  it("does not turn a notification-permission error into a failed activation", async () => {
    native.requestNotificationPermission.mockRejectedValueOnce(new Error("native unavailable"));
    saveActivationSelection({
      kind: "draft",
      draft: {
        name: "Reminder retry",
        categoryId: "health",
        type: "binary",
        target: 1,
        unit: "",
        unitKind: "count",
        scheduleKind: "weekdays",
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        monthlyGoal: "30",
        reminderTime: "09:00",
      },
    });
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<ActivationPage />));
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "شروع ۷ روز رایگان",
      )!,
    );

    expect(app.db?.subscription?.trial).toBe(true);
    expect(app.db?.habits).toEqual([expect.objectContaining({ name: "Reminder retry" })]);
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("does not accept a non-trial server entitlement or create the starter habit", async () => {
    api.startTrial.mockResolvedValueOnce({
      started: false,
      entitlement: { ...trialEntitlement, planId: "m1" },
    });
    api.entitlementToSubscription.mockReturnValueOnce({
      planId: "m1",
      startedAt: 1,
      expiresAt: Date.parse(trialEntitlement.expiresAt),
      trial: false,
    });
    await click(
      [...host.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("مطالعهٔ درسی"),
      )!,
    );
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "شروع ۷ روز رایگان",
      )!,
    );

    expect(app.db?.subscription).toBeNull();
    expect(app.db?.habits).toEqual([]);
    expect(loadActivationSelection()).toMatchObject({ kind: "draft" });
  });
});
