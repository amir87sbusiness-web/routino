import { beforeEach, describe, expect, it } from "vitest";
import { accessExpiryAt, loadTokens } from "./auth";

const TOKEN_KEY = "routino:auth:v1";

function tokenWith(payload: object): string {
  const encoded = btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${encoded}.signature`;
}

describe("access token expiry", () => {
  beforeEach(() => localStorage.clear());

  it("reads the signed expiry instead of assuming a client-only TTL", () => {
    expect(accessExpiryAt(tokenWith({ exp: 4_000 }), 1_000)).toBe(4_000_000);
  });

  it("uses a conservative fallback for malformed legacy tokens", () => {
    expect(accessExpiryAt("invalid", 5_000)).toBe(5_000 + 60 * 60_000);
  });

  it("migrates legacy refresh and device fields out of storage", () => {
    const legacy = {
      access: tokenWith({ sub: "user-a", exp: 4_000 }),
      refresh: "legacy-refresh",
      deviceId: "legacy-device",
      accessExpiresAt: 4_000_000,
      lastServerConfirmedAt: 3_000,
      lastEntitlementCheckedAt: 2_000,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(legacy));

    expect(loadTokens()).toEqual({
      access: legacy.access,
      accessExpiresAt: 4_000_000,
      lastServerConfirmedAt: 3_000,
      lastEntitlementCheckedAt: 2_000,
    });
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY)!)).toEqual({
      access: legacy.access,
      accessExpiresAt: 4_000_000,
      lastServerConfirmedAt: 3_000,
      lastEntitlementCheckedAt: 2_000,
    });
  });
});
