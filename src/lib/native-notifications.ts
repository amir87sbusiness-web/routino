/**
 * لایه‌ی نوتیفیکیشن بومی برای نسخه‌ی موبایل (Capacitor).
 *
 * تفاوت با سیستم قبلی (state/app.tsx):
 * سیستم قبلی هر ۳۰ ثانیه‌یک‌بار زمان را چک می‌کند و فقط وقتی خودِ اپ باز و
 * در فرگراند است نوتیف مرورگر می‌سازد. این ماژول به‌جای آن، نوتیفیکیشن‌ها را
 * از قبل نزد سیستم‌عامل (iOS/Android) زمان‌بندی می‌کند تا حتی وقتی اپ کاملاً
 * بسته است هم در زمان مقرر نمایش داده شوند.
 *
 * روی وب (npm run dev / build عادی) این ماژول کاملاً بی‌اثر است — چون
 * Capacitor.isNativePlatform() آنجا false برمی‌گردد و توابع زودتر return
 * می‌کنند. یعنی نسخه‌ی وب فعلی هیچ تغییر رفتاری نمی‌بیند.
 */
import { Capacitor } from "@capacitor/core";
import type { Db } from "./store";
import { dueHabitsOn, isCompleted, getLog } from "./logic";
import { todayKey } from "./dates";

// شناسه‌های عددی نوتیف را با هش ساده از رشته‌ی id می‌سازیم چون
// LocalNotifications به عدد صحیح ۳۲بیتی نیاز دارد، نه رشته.
function idFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

export async function isNative(): Promise<boolean> {
  return Capacitor.isNativePlatform();
}

/** درخواست مجوز نوتیفیکیشن از کاربر؛ باید هنگام روشن‌کردن سوییچ در تنظیمات صدا زده شود. */
export async function requestNativePermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true; // در وب، منطق موجود مرورگر مسئول است
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const perm = await LocalNotifications.requestPermissions();
  return perm.display === "granted";
}

/**
 * تمام یادآوری‌های تکرارشونده (عادت‌های روزانه با reminderTime و ژورنال) را
 * دوباره با سیستم‌عامل زمان‌بندی می‌کند. هر بار که db تغییر می‌کند (عادت
 * جدید، تغییر ساعت یادآوری، خاموش/روشن‌شدن نوتیف) باید صدا زده شود.
 */
export async function syncRecurringReminders(db: Db): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");

  // اول همه‌ی نوتیف‌های تکرارشونده‌ی قبلی را پاک می‌کنیم تا با state تازه جایگزین شوند
  const pending = await LocalNotifications.getPending();
  const recurringIds = pending.notifications
    .filter((n) => n.extra?.kind === "recurring")
    .map((n) => n.id);
  if (recurringIds.length) {
    await LocalNotifications.cancel({ notifications: recurringIds.map((id) => ({ id })) });
  }

  if (!db.settings.notificationsEnabled) return;

  const fa = db.settings.lang === "fa";
  const toSchedule: {
    id: number;
    title: string;
    body: string;
    schedule: { on: { hour: number; minute: number } };
    extra: { kind: "recurring" };
  }[] = [];

  for (const h of db.habits) {
    if (h.archived || !h.reminderTime) continue;
    const [hh, mm] = h.reminderTime.split(":").map(Number);
    toSchedule.push({
      id: idFromString(`habit|${h.id}`),
      title: fa ? "یادآوری عادت" : "Habit reminder",
      body: fa ? `وقتشه: ${h.name}` : `Time for: ${h.name}`,
      schedule: { on: { hour: hh, minute: mm } },
      extra: { kind: "recurring" },
    });
  }

  if (db.settings.journalReminder) {
    const [hh, mm] = db.settings.journalReminder.split(":").map(Number);
    toSchedule.push({
      id: idFromString("journal-daily"),
      title: fa ? "ژورنال روتینو" : "Routino Journal",
      body: fa ? "وقت ژورنال‌نویسیه ✍️" : "Time to write your journal ✍️",
      schedule: { on: { hour: hh, minute: mm } },
      extra: { kind: "recurring" },
    });
  }

  if (toSchedule.length) {
    await LocalNotifications.schedule({ notifications: toSchedule });
  }
}

/**
 * برای یادآوری‌های یک‌بارمصرف تسک‌ها (task.reminderAt) — این‌ها یک زمان دقیق
 * دارند نه یک ساعت تکرارشونده، پس جدا زمان‌بندی می‌شوند.
 */
export async function scheduleTaskReminder(taskId: string, title: string, reminderAtIso: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const at = new Date(reminderAtIso);
  if (at.getTime() <= Date.now()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.schedule({
    notifications: [
      {
        id: idFromString(`task|${taskId}`),
        title: "Task reminder",
        body: title,
        schedule: { at },
        extra: { kind: "task" },
      },
    ],
  });
}

export async function cancelTaskReminder(taskId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.cancel({ notifications: [{ id: idFromString(`task|${taskId}`) }] });
}


