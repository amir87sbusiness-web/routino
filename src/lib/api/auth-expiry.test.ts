import { beforeEach, describe, expect, it } from "vitest";
import { accessExpiryAt, accessRefreshDue, loadTokens, type Tokens } from "./auth";

const TOKEN_KEY = "routino:auth:v1";
const DAY = 24 * 60 * 60_000;

function tokenWith(payload: object): string {
  const encoded = btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${encoded}.signature`;
}

function session(issuedAtMs: number, lifetimeDays: number, accountDeletionAt?: number): Tokens {
  const accessExpiresAt = issuedAtMs + lifetimeDays * DAY;
  return {
    access: tokenWith({
      sub: "user-a",
      iat: issuedAtMs / 1000,
      exp: accessExpiresAt / 1000,
    }),
    accessExpiresAt,
    ...(accountDeletionAt === undefined ? {} : { accountDeletionAt }),
  };
}

describe("access token expiry", () => {
  beforeEach(() => localStorage.clear());

  it("reads the signed expiry instead of assuming a client-only TTL", () => {
    expect(accessExpiryAt(tokenWith({ exp: 4_000 }), 1_000)).toBe(4_000_000);
  });

  it("uses a conservative fallback for malformed legacy tokens", () => {
    expect(accessExpiryAt("invalid", 5_000)).toBe(5_000 + 60 * 60_000);
  });

  it("renews a normal 90-day session only after 45 days", () => {
    const issuedAt = 1_700_000_000_000;
    const tokens = session(issuedAt, 90);

    expect(accessRefreshDue(tokens, issuedAt + 44 * DAY)).toBe(false);
    expect(accessRefreshDue(tokens, issuedAt + 45 * DAY)).toBe(true);
  });

  it("upgrades an old 30-day session on its first request after the release", () => {
    const issuedAt = 1_700_000_000_000;
    expect(accessRefreshDue(session(issuedAt, 30), issuedAt + DAY)).toBe(true);
  });

  it("does not mistake an account-deletion-capped token for a legacy session", () => {
    const issuedAt = 1_700_000_000_000;
    const deletionAt = issuedAt + 30 * DAY;
    const tokens = session(issuedAt, 30, deletionAt);

    expect(accessRefreshDue(tokens, issuedAt + DAY)).toBe(false);
  });

  it("never attempts renewal after the token has already expired", () => {
    const issuedAt = 1_700_000_000_000;
    const tokens = session(issuedAt, 90);

    expect(accessRefreshDue(tokens, issuedAt + 90 * DAY)).toBe(false);
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
      lastEntitlementCheckedAt: 2_000,
    });
    expect(JSON.parse(localStorage.getItem(TOKEN_KEY)!)).toEqual({
      access: legacy.access,
      accessExpiresAt: 4_000_000,
      lastEntitlementCheckedAt: 2_000,
    });
  });
});
