import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_EXPIRY_REFRESH_MS,
  ENTITLEMENT_REFRESH_MS,
  shouldRefreshEntitlement,
} from "./entitlement-refresh";

const hour = 60 * 60 * 1000;

describe("shouldRefreshEntitlement", () => {
  it("refreshes when this device has no successful entitlement check", () => {
    expect(shouldRefreshEntitlement({ now: 10_000, lastCheckedAt: undefined })).toBe(true);
  });

  it("uses a six-hour cadence for subscriptions far from expiry", () => {
    const now = 10 * hour;
    const expiresAt = now + 30 * 24 * hour;
    expect(
      shouldRefreshEntitlement({ now, lastCheckedAt: now - ENTITLEMENT_REFRESH_MS + 1, expiresAt }),
    ).toBe(false);
    expect(
      shouldRefreshEntitlement({ now, lastCheckedAt: now - ENTITLEMENT_REFRESH_MS, expiresAt }),
    ).toBe(true);
  });

  it("checks hourly during the final three days", () => {
    const now = 20 * hour;
    const expiresAt = now + 2 * 24 * hour;
    expect(
      shouldRefreshEntitlement({
        now,
        lastCheckedAt: now - ENTITLEMENT_EXPIRY_REFRESH_MS + 1,
        expiresAt,
      }),
    ).toBe(false);
    expect(
      shouldRefreshEntitlement({
        now,
        lastCheckedAt: now - ENTITLEMENT_EXPIRY_REFRESH_MS,
        expiresAt,
      }),
    ).toBe(true);
  });

  it("supports forced checks and treats a backwards device clock as stale", () => {
    expect(shouldRefreshEntitlement({ now: 1_000, lastCheckedAt: 2_000 })).toBe(true);
    expect(shouldRefreshEntitlement({ now: 2_000, lastCheckedAt: 1_999, force: true })).toBe(true);
  });
});
