import { describe, expect, it } from "vitest";
import { accessExpiryAt } from "./auth";

function tokenWith(payload: object): string {
  const encoded = btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${encoded}.signature`;
}

describe("access token expiry", () => {
  it("reads the signed expiry instead of assuming a client-only TTL", () => {
    expect(accessExpiryAt(tokenWith({ exp: 4_000 }), 1_000)).toBe(4_000_000);
  });

  it("uses a conservative fallback for malformed legacy tokens", () => {
    expect(accessExpiryAt("invalid", 5_000)).toBe(5_000 + 60 * 60_000);
  });
});
