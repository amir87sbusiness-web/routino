import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb } from "./store";
import { DAY_MS, subscriptionReminderEvents, THREE_DAYS_MS } from "./subscription-reminders";

const NOW = Date.UTC(2026, 7, 18, 12);

function subscribed(expiresAt: number) {
  const db = defaultDb(DEFAULT_CATEGORIES);
  db.auth = { phone: "989120000000", verifiedAt: NOW };
  db.subscription = { planId: "p1", startedAt: NOW - 10_000, expiresAt };
  return db;
}

function trial(expiresAt: number) {
  const db = subscribed(expiresAt);
  db.subscription = { ...db.subscription!, planId: "trial", trial: true };
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

  it("warns on the final trial day and again after trial expiry", () => {
    const db = trial(NOW + DAY_MS);
    const [warning] = subscriptionReminderEvents(db, NOW);
    expect(warning).toMatchObject({ kind: "expires-soon" });
    expect(warning.key).toContain("trial|");

    db.meta.firedReminders.push(warning.key);
    const [expired] = subscriptionReminderEvents(db, NOW + DAY_MS + 1);
    expect(expired).toMatchObject({ kind: "expired" });
    expect(expired.key).toContain("trial|");
  });

  it("explains that expired data remains available locally and in the cloud", () => {
    const [event] = subscriptionReminderEvents(subscribed(NOW - 1), NOW);
    expect(event.body.en).toContain("cloud");
    expect(event.body.en).toContain("device");
  });

  it("does not warn early or without a signed-in subscription", () => {
    expect(subscriptionReminderEvents(subscribed(NOW + THREE_DAYS_MS + 1), NOW)).toEqual([]);
    const db = subscribed(NOW + 1_000);
    db.auth = null;
    expect(subscriptionReminderEvents(db, NOW)).toEqual([]);
  });
});
