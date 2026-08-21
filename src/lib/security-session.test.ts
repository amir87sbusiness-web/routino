import { describe, expect, it } from "vitest";
import { OFFLINE_LEASE_MS, decideSession } from "./security-session";

const confirmedAt = Date.UTC(2026, 0, 1);

describe("15-day offline security lease", () => {
  it("keeps the app available before the boundary", () => {
    expect(
      decideSession({
        now: confirmedAt + OFFLINE_LEASE_MS - 1,
        lastServerConfirmedAt: confirmedAt,
        online: false,
      }),
    ).toMatchObject({ kind: "offline-valid" });
  });

  it("requires a short connection exactly at 15 days", () => {
    expect(
      decideSession({
        now: confirmedAt + OFFLINE_LEASE_MS,
        lastServerConfirmedAt: confirmedAt,
        online: false,
      }),
    ).toEqual({ kind: "needs-online-confirmation" });
  });

  it("treats a fresh successful check as valid", () => {
    expect(
      decideSession({
        now: confirmedAt + OFFLINE_LEASE_MS * 2,
        lastServerConfirmedAt: confirmedAt,
        online: true,
        serverConfirmed: true,
      }),
    ).toEqual({ kind: "valid" });
  });

  it.each(["device_replaced", "device_revoked"] as const)(
    "locks credentials on a definitive %s response without a data-wipe instruction",
    (reason) => {
      expect(
        decideSession({
          now: confirmedAt + 1,
          lastServerConfirmedAt: confirmedAt,
          online: true,
          revokedReason: reason,
        }),
      ).toEqual({ kind: "revoked", reason });
    },
  );
});
