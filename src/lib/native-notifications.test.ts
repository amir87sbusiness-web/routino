import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb, type Db } from "./store";

const native = vi.hoisted(() => ({ platform: "android", isNative: true }));
interface FakeNotification {
  id: number;
  title: string;
  body: string;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

const os = vi.hoisted(() => {
  const pending: FakeNotification[] = [];
  return {
    pending,
    permission: "granted",
    exact: "granted",
    requestPermissions: vi.fn(async () => ({ display: "granted" })),
    checkPermissions: vi.fn(async () => ({ display: os.permission })),
    getPending: vi.fn(async () => ({ notifications: [...pending] })),
    cancel: vi.fn(async ({ notifications }: { notifications: Array<{ id: number }> }) => {
      for (const item of notifications) {
        const index = pending.findIndex((candidate) => candidate.id === item.id);
        if (index >= 0) pending.splice(index, 1);
      }
    }),
    schedule: vi.fn(async ({ notifications }: { notifications: FakeNotification[] }) => {
      for (const item of notifications) {
        const index = pending.findIndex((candidate) => candidate.id === item.id);
        if (index >= 0) pending.splice(index, 1);
        pending.push(item);
      }
      return { notifications: notifications.map(({ id }) => ({ id })) };
    }),
    checkExactNotificationSetting: vi.fn(async () => ({ exact_alarm: os.exact })),
    changeExactNotificationSetting: vi.fn(async () => ({ exact_alarm: os.exact })),
  };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native.isNative,
    getPlatform: () => native.platform,
  },
}));

vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: os }));

import {
  checkNativeExactAlarmSetting,
  checkNativeNotificationPermission,
  notificationDeliveryActive,
  reconcileNativeReminders,
  requestNativeExactAlarmSetting,
  requestNotificationPermission,
} from "./native-notifications";

const NOW = new Date(2026, 7, 17, 6, 0);

function reminderDb(): Db {
  const db = defaultDb(DEFAULT_CATEGORIES);
  db.settings.lang = "en";
  db.settings.calendar = "gregorian";
  db.settings.notificationsEnabled = true;
  db.settings.journalReminder = null;
  db.habits = [
    {
      id: "habit-1",
      name: "Read",
      categoryId: "health",
      type: "binary",
      target: 1,
      schedule: { kind: "weekdays", weekdays: [1, 3] },
      monthlyGoal: null,
      reminderTime: "08:00",
      createdAt: new Date(2026, 7, 1).getTime(),
    },
  ];
  return db;
}

beforeEach(() => {
  native.isNative = true;
  native.platform = "android";
  os.permission = "granted";
  os.exact = "granted";
  os.pending.splice(0);
  vi.clearAllMocks();
});

describe("native reminder reconciliation", () => {
  it("reports the Settings switch active only when preference and OS permission agree", () => {
    expect(notificationDeliveryActive(true, "granted")).toBe(true);
    expect(notificationDeliveryActive(true, "denied")).toBe(false);
    expect(notificationDeliveryActive(true, "prompt")).toBe(false);
    expect(notificationDeliveryActive(false, "granted")).toBe(false);
  });

  it("checks denial without requesting permission or scheduling", async () => {
    os.permission = "denied";
    os.pending.push({ id: 71, title: "old", body: "old", extra: { routino: true } });

    const result = await reconcileNativeReminders(reminderDb(), {
      now: NOW,
      productRemindersAllowed: true,
      lifecycleRemindersAllowed: true,
    });

    expect(result).toEqual({ status: "permission-denied", scheduled: 0 });
    expect(os.requestPermissions).not.toHaveBeenCalled();
    expect(os.schedule).not.toHaveBeenCalled();
    expect(os.pending).toEqual([]);
  });

  it("rebuilds reminders when permission becomes available later", async () => {
    os.permission = "denied";
    const options = {
      now: NOW,
      productRemindersAllowed: true,
      lifecycleRemindersAllowed: true,
    };
    await reconcileNativeReminders(reminderDb(), options);
    os.permission = "granted";

    const result = await reconcileNativeReminders(reminderDb(), options);

    expect(result).toEqual({ status: "scheduled", scheduled: 2 });
    expect(os.pending.filter((item) => item.extra?.routino === true)).toHaveLength(2);
  });

  it("replaces only Routino-owned pending requests and remains duplicate-free", async () => {
    os.pending.push(
      { id: 999, title: "other", body: "other", extra: { owner: "another-plugin" } },
      { id: 71, title: "old", body: "old", extra: { routino: true } },
      { id: 72, title: "legacy", body: "legacy", extra: { kind: "recurring" } },
    );
    const options = {
      now: NOW,
      productRemindersAllowed: true,
      lifecycleRemindersAllowed: true,
    };

    const first = await reconcileNativeReminders(reminderDb(), options);
    const second = await reconcileNativeReminders(reminderDb(), options);

    expect(first).toEqual({ status: "scheduled", scheduled: 2 });
    expect(second).toEqual(first);
    expect(os.requestPermissions).not.toHaveBeenCalled();
    expect(os.pending.find((item) => item.id === 999)?.title).toBe("other");
    expect(os.pending.some((item) => item.extra?.kind === "recurring")).toBe(false);
    expect(os.pending.filter((item) => item.extra?.routino === true)).toHaveLength(2);
    expect(new Set(os.pending.map((item) => item.id)).size).toBe(os.pending.length);
    expect(
      os.cancel.mock.calls.flatMap(([arg]) => arg.notifications).some(({ id }) => id === 999),
    ).toBe(false);
  });

  it("clears Routino schedules when both reminder categories are disabled", async () => {
    os.pending.push(
      { id: 50, title: "owned", body: "owned", extra: { routino: true } },
      { id: 51, title: "other", body: "other", extra: { routino: false } },
    );

    const result = await reconcileNativeReminders(reminderDb(), {
      now: NOW,
      productRemindersAllowed: false,
      lifecycleRemindersAllowed: false,
    });

    expect(result).toEqual({ status: "disabled", scheduled: 0 });
    expect(os.checkPermissions).not.toHaveBeenCalled();
    expect(os.pending.map((item) => item.id)).toEqual([51]);
  });

  it("reports display and Android exact-alarm settings without prompting", async () => {
    os.permission = "prompt";
    os.exact = "denied";

    expect(await checkNativeNotificationPermission()).toBe("prompt");
    expect(await checkNativeExactAlarmSetting()).toBe("denied");
    expect(os.requestPermissions).not.toHaveBeenCalled();
    expect(os.changeExactNotificationSetting).not.toHaveBeenCalled();

    os.exact = "granted";
    expect(await requestNativeExactAlarmSetting()).toBe("granted");
    expect(os.changeExactNotificationSetting).toHaveBeenCalledTimes(1);
  });

  it("requests browser permission only through the explicit cross-platform helper", async () => {
    native.isNative = false;
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    vi.stubGlobal("Notification", { permission: "default", requestPermission });

    expect(await requestNotificationPermission()).toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
