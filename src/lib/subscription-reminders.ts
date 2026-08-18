import type { Db } from "./store";

export const THREE_DAYS_MS = 3 * 86_400_000;

export interface SubscriptionReminderEvent {
  kind: "expires-soon" | "expired";
  key: string;
  title: { fa: string; en: string };
  body: { fa: string; en: string };
}

export function subscriptionReminderEvents(
  db: Db,
  now = Date.now(),
): SubscriptionReminderEvent[] {
  if (!db.auth || !db.subscription || db.subscription.trial) return [];
  const expiry = db.subscription.expiresAt;
  const remaining = expiry - now;
  const kind = remaining <= 0 ? "expired" : remaining <= THREE_DAYS_MS ? "expires-soon" : null;
  if (!kind) return [];
  const key = `subscription|${kind}|${expiry}`;
  if (db.meta.firedReminders.includes(key)) return [];

  return [
    kind === "expires-soon"
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
            fa: "اشتراکت به پایان رسید. اطلاعاتت روی این دستگاه امن و دست‌نخورده می‌ماند.",
            en: "Your subscription has expired. Your data remains safe and untouched on this device.",
          },
        },
  ];
}
