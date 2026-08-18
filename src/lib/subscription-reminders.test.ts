import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb } from "./store";
import { subscriptionReminderEvents, THREE_DAYS_MS } from "./subscription-reminders";

const NOW = Date.UTC(2026, 7, 18, 12);

function subscribed(expiresAt: number) {
  const db = defaultDb(DEFAULT_CATEGORIES);
  db.auth = { phone: "989120000000", verifiedAt: NOW };
  db.subscription = { planId: "p1", startedAt: NOW - 10_000, expiresAt };
  return db;
}

describe("subscriptionReminderEvents", () => {
  it("warns once when three days or less remain", () => {
    const db = subscribed(NOW + THREE_DAYS_MS);
    const [event] = subscriptionReminderEvents(db, NOW);
    expect(event.kind).toBe("expires-soon");
    db.meta.firedReminders.push(event.key);
    expect(subscriptionReminderEvents(db, NOW + 1_000)).toEqual([]);
  });

  it("notifies once when the subscription has expired", () => {
    const db = subscribed(NOW - 1);
    const [event] = subscriptionReminderEvents(db, NOW);
    expect(event.kind).toBe("expired");
    db.meta.firedReminders.push(event.key);
    expect(subscriptionReminderEvents(db, NOW + 86_400_000)).toEqual([]);
  });

  it("does not warn early or without a signed-in subscription", () => {
    expect(subscriptionReminderEvents(subscribed(NOW + THREE_DAYS_MS + 1), NOW)).toEqual([]);
    const db = subscribed(NOW + 1_000);
    db.auth = null;
    expect(subscriptionReminderEvents(db, NOW)).toEqual([]);
  });
});
