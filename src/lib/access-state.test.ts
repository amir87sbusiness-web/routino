import { describe, expect, it } from "vitest";
import { accessRoute, accessState, productWriteAllowed } from "./access-state";
import { defaultDb } from "./store";

const authedDb = () => ({
  ...defaultDb([]),
  auth: { userId: "user-1", phone: "989123334444", verifiedAt: 1 },
  meta: { ...defaultDb([]).meta, legacyEntitlementMigrationResolved: true },
});

describe("accessState", () => {
  it("does not mistake a loading entitlement for pretrial", () => {
    expect(accessState(null, "checking")).toBe("checking");
    expect(
      accessState(
        { ...authedDb(), meta: { ...authedDb().meta, legacyEntitlementMigrationResolved: false } },
        "ready",
      ),
    ).toBe("checking");
  });

  it("routes only a resolved authoritative none entitlement to pretrial", () => {
    expect(accessState(defaultDb([]), "ready")).toBe("unauthenticated");
    expect(accessState(authedDb(), "ready")).toBe("pretrial");
    expect(accessRoute("pretrial")).toBe("/activation");
    expect(accessRoute("expired")).toBeNull();
  });

  it("keeps active trial, active paid, expired, and tampered states distinct", () => {
    const now = 1_000;
    expect(
      accessState(
        { ...authedDb(), subscription: { planId: "trial", startedAt: 1, expiresAt: 1_001 } },
        "ready",
        now,
      ),
    ).toBe("active-trial");
    expect(
      accessState(
        {
          ...authedDb(),
          subscription: { planId: "m3", startedAt: 1, expiresAt: 1_001, trial: false },
        },
        "ready",
        now,
      ),
    ).toBe("active-paid");
    expect(
      accessState(
        { ...authedDb(), subscription: { planId: "trial", startedAt: 1, expiresAt: 1_000 } },
        "ready",
        now,
      ),
    ).toBe("expired");
    expect(
      accessState(
        {
          ...authedDb(),
          subscription: { planId: "trial", startedAt: 1, expiresAt: 1_001 },
          meta: { ...authedDb().meta, tampered: true },
        },
        "ready",
        now,
      ),
    ).toBe("needs-online-verification");
  });

  it("does not offer a second pretrial state when a previous trial is expired", () => {
    const state = accessState(
      {
        ...authedDb(),
        subscription: { planId: "trial", startedAt: 1, expiresAt: 999, trial: true },
      },
      "ready",
      1_000,
    );

    expect(state).toBe("expired");
    expect(accessRoute(state)).toBeNull();
  });

  it("requires online verification for clock rollback instead of routing to purchase", () => {
    const state = accessState(
      {
        ...authedDb(),
        subscription: { planId: "m3", startedAt: 1, expiresAt: 10_000, trial: false },
        meta: { ...authedDb().meta, tampered: true, lastSeen: 9_000 },
      },
      "ready",
      2_000,
    );

    expect(state).toBe("needs-online-verification");
    expect(accessRoute(state)).toBeNull();
  });

  it("allows product writes only for authoritative active trial or paid access", () => {
    const trial = {
      ...authedDb(),
      subscription: { planId: "trial", startedAt: 1, expiresAt: 2_000, trial: true },
    };
    const paid = {
      ...authedDb(),
      subscription: { planId: "m1", startedAt: 1, expiresAt: 2_000, trial: false },
    };

    expect(productWriteAllowed(trial, "ready", 1_000)).toBe(true);
    expect(productWriteAllowed(paid, "ready", 1_000)).toBe(true);
    expect(
      productWriteAllowed(
        { ...paid, subscription: { ...paid.subscription, expiresAt: 999 } },
        "ready",
        1_000,
      ),
    ).toBe(false);
    expect(
      productWriteAllowed({ ...paid, meta: { ...paid.meta, tampered: true } }, "ready", 1_000),
    ).toBe(false);
  });
});
