import { describe, expect, it, vi } from "vitest";
import type { ServerEntitlement } from "./api/auth";
import { ApiError } from "./api/client";
import { resolveServerEntitlement } from "./entitlement-migration";
import { defaultDb, type Db, type Subscription } from "./store";

const NOW = Date.parse("2026-08-21T12:00:00Z");
const none: ServerEntitlement = {
  status: "none",
  planId: null,
  expiresAt: null,
  issuedAt: "2026-08-21T12:00:00.000Z",
};

const activeServer: ServerEntitlement = {
  status: "active",
  planId: "m3",
  expiresAt: "2026-11-21T12:00:00.000Z",
  issuedAt: "2026-08-21T12:00:00.000Z",
};

const legacy: Subscription = {
  planId: "legacy",
  startedAt: NOW - 30 * 86_400_000,
  expiresAt: NOW + 30 * 86_400_000,
  trial: false,
};

function dbWith(subscription: Subscription | null, resolved = false): Db {
  const db = defaultDb([]);
  return {
    ...db,
    subscription,
    meta: {
      ...db.meta,
      tampered: true,
      lastSeen: NOW + 3_600_000,
      legacyEntitlementMigrationResolved: resolved,
    },
  };
}

describe("resolveServerEntitlement", () => {
  it("temporarily preserves a genuine legacy plan when import transport fails", async () => {
    const importLegacy = vi.fn().mockRejectedValue(new Error("offline"));
    const result = await resolveServerEntitlement(dbWith(legacy), none, importLegacy, NOW);

    expect(importLegacy).toHaveBeenCalledWith(legacy);
    expect(result.subscription).toEqual(legacy);
    expect(result.meta.legacyEntitlementMigrationResolved).toBe(false);
    expect(result.meta.tampered).toBe(false);
    expect(result.meta.lastSeen).toBe(NOW);
  });

  it("treats a definitive client rejection as resolved instead of forever-local access", async () => {
    const importLegacy = vi
      .fn()
      .mockRejectedValue(new ApiError(400, "invalid_request", "legacy claim rejected"));
    const result = await resolveServerEntitlement(dbWith(legacy), none, importLegacy, NOW);

    expect(result.subscription).toBeNull();
    expect(result.meta.legacyEntitlementMigrationResolved).toBe(true);
    expect(result.meta.tampered).toBe(false);
  });

  it.each([408, 425, 429])(
    "keeps temporary HTTP %i migration failures retryable",
    async (status) => {
      const importLegacy = vi
        .fn()
        .mockRejectedValue(new ApiError(status, "retry_later", "try again later"));
      const result = await resolveServerEntitlement(dbWith(legacy), none, importLegacy, NOW);

      expect(result.subscription).toEqual(legacy);
      expect(result.meta.legacyEntitlementMigrationResolved).toBe(false);
    },
  );

  it("marks a successful migration resolved and applies the returned server access", async () => {
    const importLegacy = vi.fn().mockResolvedValue({ entitlement: activeServer, imported: true });
    const result = await resolveServerEntitlement(dbWith(legacy), none, importLegacy, NOW);

    expect(result.meta.legacyEntitlementMigrationResolved).toBe(true);
    expect(result.subscription).toMatchObject({ planId: "m3", trial: false });
    expect(result.subscription?.expiresAt).toBe(Date.parse(activeServer.expiresAt!));
  });

  it("makes future server none authoritative and never imports again once resolved", async () => {
    const importLegacy = vi.fn();
    const result = await resolveServerEntitlement(dbWith(legacy, true), none, importLegacy, NOW);

    expect(importLegacy).not.toHaveBeenCalled();
    expect(result.subscription).toBeNull();
    expect(result.meta.legacyEntitlementMigrationResolved).toBe(true);
  });

  it("resolves immediately when no usable legacy subscription exists", async () => {
    const expired = { ...legacy, expiresAt: NOW - 1 };
    const importLegacy = vi.fn();
    const result = await resolveServerEntitlement(dbWith(expired), none, importLegacy, NOW);

    expect(importLegacy).not.toHaveBeenCalled();
    expect(result.subscription).toBeNull();
    expect(result.meta.legacyEntitlementMigrationResolved).toBe(true);
  });

  it("uses authoritative server time when a rolled-back device clock sees legacy access as active", async () => {
    const deviceNow = NOW - 2 * 86_400_000;
    const expiredAtServer = { ...legacy, expiresAt: NOW - 86_400_000 };
    const importLegacy = vi.fn();
    const result = await resolveServerEntitlement(
      dbWith(expiredAtServer),
      none,
      importLegacy,
      deviceNow,
    );

    expect(importLegacy).not.toHaveBeenCalled();
    expect(result.subscription).toBeNull();
    expect(result.meta.legacyEntitlementMigrationResolved).toBe(true);
    expect(result.meta.lastSeen).toBe(deviceNow);
    expect(result.meta.tampered).toBe(false);
  });

  it("fails closed when the server-issued clock value is malformed", async () => {
    const malformed = { ...none, issuedAt: "not-a-date" };
    const importLegacy = vi.fn();
    const result = await resolveServerEntitlement(dbWith(legacy), malformed, importLegacy, NOW);

    expect(importLegacy).not.toHaveBeenCalled();
    expect(result.subscription).toBeNull();
    expect(result.meta.legacyEntitlementMigrationResolved).toBe(true);
  });

  it("lets an active server entitlement win without a redundant import", async () => {
    const importLegacy = vi.fn();
    const result = await resolveServerEntitlement(dbWith(legacy), activeServer, importLegacy, NOW);

    expect(importLegacy).not.toHaveBeenCalled();
    expect(result.subscription?.planId).toBe("m3");
    expect(result.meta.legacyEntitlementMigrationResolved).toBe(true);
  });
});
