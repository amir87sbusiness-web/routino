/** Capacitor boundary for Routino-owned local OS reminders. */
import { Capacitor } from "@capacitor/core";
import type { PermissionState } from "@capacitor/core";
import { planNativeReminders, type ReminderPlanOptions } from "./reminder-planner";
import type { Db } from "./store";

export type NativePermissionState = PermissionState | "web";
export type NativeExactAlarmState = PermissionState | "not-android";

export interface NativeReminderOptions extends Omit<ReminderPlanOptions, "now"> {
  now?: Date;
}

export interface NativeReconcileResult {
  status: "web" | "disabled" | "permission-denied" | "scheduled";
  scheduled: number;
}

export function notificationDeliveryActive(
  preferred: boolean,
  permission: PermissionState | "checking" | "unsupported",
): boolean {
  return preferred && permission === "granted";
}

const NATIVE_CAPACITY = 60;
const LEGACY_ROUTINO_KINDS = new Set(["recurring", "task", "subscription"]);
let reconcileQueue: Promise<void> = Promise.resolve();

function isRoutinoOwned(extra: Record<string, unknown> | undefined): boolean {
  if (extra?.routino === true) return true;
  // One-release migration for alarms created by the previous Routino adapter.
  // These were the only Local Notifications kinds the app emitted, and must be
  // removed once or they survive beside the new deterministic plan.
  return typeof extra?.kind === "string" && LEGACY_ROUTINO_KINDS.has(extra.kind);
}

export function isNativeRuntime(): boolean {
  return Capacitor.isNativePlatform();
}

/** Read-only permission check. This function never opens an OS dialog. */
export async function checkNativeNotificationPermission(): Promise<NativePermissionState> {
  if (!isNativeRuntime()) return "web";
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return (await LocalNotifications.checkPermissions()).display;
}

/** Explicit user-action path used by Settings/activation only. */
export async function requestNativePermission(): Promise<boolean> {
  if (!isNativeRuntime()) return true;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return (await LocalNotifications.requestPermissions()).display === "granted";
}

/** Explicit cross-platform request for reminder delivery permission. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (isNativeRuntime()) return requestNativePermission();
  if (typeof Notification === "undefined") return false;
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  return permission === "granted";
}

/** Android-only read of whether AlarmManager may schedule exact alarms. */
export async function checkNativeExactAlarmSetting(): Promise<NativeExactAlarmState> {
  if (!isNativeRuntime() || Capacitor.getPlatform() !== "android") return "not-android";
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm;
}

/** Opens Android's exact-alarm settings; call only after an explicit user action. */
export async function requestNativeExactAlarmSetting(): Promise<NativeExactAlarmState> {
  if (!isNativeRuntime() || Capacitor.getPlatform() !== "android") return "not-android";
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return (await LocalNotifications.changeExactNotificationSetting()).exact_alarm;
}

async function runReconcile(
  db: Db,
  options: NativeReminderOptions,
): Promise<NativeReconcileResult> {
  if (!isNativeRuntime()) return { status: "web", scheduled: 0 };

  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const pending = await LocalNotifications.getPending();
  const owned = pending.notifications.filter((item) => isRoutinoOwned(item.extra));
  const cancelOwned = async () => {
    if (owned.length) {
      await LocalNotifications.cancel({
        notifications: owned.map(({ id }) => ({ id })),
      });
    }
  };

  if (!options.productRemindersAllowed && !options.lifecycleRemindersAllowed) {
    await cancelOwned();
    return { status: "disabled", scheduled: 0 };
  }

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") {
    await cancelOwned();
    return { status: "permission-denied", scheduled: 0 };
  }

  const unrelatedCount = pending.notifications.length - owned.length;
  const available = Math.max(
    0,
    Math.min(options.maxPending ?? NATIVE_CAPACITY, NATIVE_CAPACITY - unrelatedCount),
  );
  const plan = planNativeReminders(db, {
    ...options,
    now: options.now ?? new Date(),
    maxPending: available,
  });

  // Schedule/replace desired ids first. Only after that succeeds remove ids no
  // longer present in the plan, so a transient scheduling failure cannot wipe
  // every previously working reminder.
  if (plan.length) await LocalNotifications.schedule({ notifications: plan });
  const desiredIds = new Set(plan.map(({ id }) => id));
  const obsolete = owned.filter(({ id }) => !desiredIds.has(id));
  if (obsolete.length) {
    await LocalNotifications.cancel({
      notifications: obsolete.map(({ id }) => ({ id })),
    });
  }
  return { status: "scheduled", scheduled: plan.length };
}

/**
 * Replaces the complete Routino-owned pending set from current DB state.
 * Calls are serialized so a slower stale reconciliation cannot overwrite a
 * newer one. Unrelated pending notifications are never cancelled.
 */
export function reconcileNativeReminders(
  db: Db,
  options: NativeReminderOptions,
): Promise<NativeReconcileResult> {
  const result = reconcileQueue.then(() => runReconcile(db, options));
  reconcileQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
