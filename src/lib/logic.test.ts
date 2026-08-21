/**
 * The paywall decision. Both directions are expensive: a non-payer keeping
 * access costs revenue, and a payer losing it costs a customer.
 */
import { describe, expect, it } from "vitest";
import { applyServerEntitlement, subscriptionActive } from "./logic";
import { defaultDb, type Db, type Subscription } from "./store";
import { DEFAULT_CATEGORIES } from "./presets";

const NOW = Date.parse("2026-07-30T12:00:00Z");
const active: Subscription = {
  planId: "m1",
  startedAt: NOW - 86_400_000,
  expiresAt: NOW + 86_400_000,
};

function dbWith(over: Partial<Omit<Db, "meta">> & { meta?: Partial<Db["meta"]> }): Db {
  const base = defaultDb(DEFAULT_CATEGORIES);
  return { ...base, ...over, meta: { ...base.meta, ...over.meta } };
}

describe("subscriptionActive", () => {
  it("needs a subscription that has not expired", () => {
    expect(subscriptionActive(dbWith({}), NOW)).toBe(false);
    expect(subscriptionActive(dbWith({ subscription: active }), NOW)).toBe(true);
    expect(subscriptionActive(dbWith({ subscription: active }), NOW + 2 * 86_400_000)).toBe(false);
  });

  it("refuses access when the device clock looks wound back", () => {
    expect(
      subscriptionActive(dbWith({ subscription: active, meta: { tampered: true } }), NOW),
    ).toBe(false);
  });
});

describe("applyServerEntitlement", () => {
  it("un-sticks the tamper flag when the server vouches for the account", () => {
    // Regression: `tampered` is sticky and gates the whole app, and only a fresh
    // PAYMENT used to clear it. So a paying customer whose phone clock ran fast
    // and was then corrected backwards was locked out permanently — the server
    // could confirm their subscription and they still could not get in.
    const locked = dbWith({
      subscription: active,
      meta: { tampered: true, lastSeen: NOW + 3_600_000 },
    });
    expect(subscriptionActive(locked, NOW)).toBe(false);

    const healed = applyServerEntitlement(locked, active, NOW);
    expect(healed.meta.tampered).toBe(false);
    expect(subscriptionActive(healed, NOW)).toBe(true);
  });

  it("re-baselines lastSeen to the device clock, so the guard does not re-fire", () => {
    // Writing the SERVER's time here instead would re-raise the flag on the next
    // heartbeat whenever the two clocks disagree by more than the tolerance.
    const locked = dbWith({
      subscription: active,
      meta: { tampered: true, lastSeen: NOW + 3_600_000 },
    });
    const healed = applyServerEntitlement(locked, active, NOW);
    expect(healed.meta.lastSeen).toBe(NOW);
  });

  it("applies an authoritative empty answer and heals clock state", () => {
    const cached = dbWith({
      subscription: active,
      meta: { tampered: true, lastSeen: NOW + 3_600_000 },
    });
    const cleared = applyServerEntitlement(cached, null, NOW);
    expect(cleared.subscription).toBeNull();
    expect(cleared.meta.tampered).toBe(false);
    expect(cleared.meta.lastSeen).toBe(NOW);
  });
});
