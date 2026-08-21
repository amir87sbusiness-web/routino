import type { Db } from "./store";

export const DAY_MS = 86_400_000;
export const THREE_DAYS_MS = 3 * DAY_MS;

export interface SubscriptionReminderEvent {
  kind: "expires-soon" | "expired";
  key: string;
  title: { fa: string; en: string };
  body: { fa: string; en: string };
}

export function subscriptionReminderEvents(db: Db, now = Date.now()): SubscriptionReminderEvent[] {
  if (!db.auth || !db.subscription) return [];
  const expiry = db.subscription.expiresAt;
  const remaining = expiry - now;
  const trial = db.subscription.trial === true;
  const warningWindow = trial ? DAY_MS : THREE_DAYS_MS;
  const kind = remaining <= 0 ? "expired" : remaining <= warningWindow ? "expires-soon" : null;
  if (!kind) return [];
  const key = `${trial ? "trial" : "subscription"}|${kind}|${expiry}`;
  if (db.meta.firedReminders.includes(key)) return [];

  return [
    kind === "expires-soon" && trial
      ? {
          kind,
          key,
          title: { fa: "روز آخر دورهٔ آزمایشی", en: "Final trial day" },
          body: {
            fa: "امروز آخرین روز دورهٔ آزمایشی توست؛ بعد از پایان، اطلاعاتت فقط‌خواندنی می‌ماند.",
            en: "Today is your final trial day. After it ends, your data remains available read-only.",
          },
        }
      : kind === "expires-soon"
        ? {
            kind,
            key,
            title: { fa: "یادآوری اشتراک روتینو", en: "Routino subscription reminder" },
            body: {
              fa: "سه روز یا کمتر تا پایان اشتراکت باقی مانده است.",
              en: "Your subscription expires in three days or less.",
            },
          }
        : {
            kind,
            key,
            title: { fa: "اشتراک روتینو پایان یافت", en: "Routino subscription expired" },
            body: {
              fa: `${trial ? "دورهٔ آزمایشی" : "اشتراک"} پایان یافت. اطلاعاتت روی دستگاه و فضای ابری امن و فقط‌خواندنی می‌ماند.`,
              en: `Your ${trial ? "trial" : "subscription"} has expired. Your data remains safe and read-only on this device and in the cloud.`,
            },
          },
  ];
}
