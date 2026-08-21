import { entitlementToSubscription, type ServerEntitlement } from "./api/auth";
import { ApiError } from "./api/client";
import { applyServerEntitlement } from "./logic";
import type { Db, Subscription } from "./store";

export interface LegacyImportResult {
  entitlement: ServerEntitlement;
  imported: boolean;
  reason?: string;
}

export type LegacyEntitlementImporter = (subscription: {
  planId: string;
  expiresAt: number;
  startedAt?: number;
  trial?: boolean;
}) => Promise<LegacyImportResult>;

const RETRYABLE_CLIENT_STATUSES = new Set([408, 425, 429]);

function markResolved(db: Db): Db {
  return {
    ...db,
    meta: { ...db.meta, legacyEntitlementMigrationResolved: true },
  };
}

function applyAuthoritative(db: Db, entitlement: ServerEntitlement, now: number): Db {
  return markResolved(applyServerEntitlement(db, entitlementToSubscription(entitlement, now), now));
}

function usableLegacy(
  subscription: Subscription | null,
  now: number,
): subscription is Subscription {
  return !!subscription && subscription.expiresAt > now;
}

/**
 * Resolves the bounded bridge from old device-only subscriptions to the server.
 *
 * A successful server answer wins immediately once resolved. Before then, only
 * `none` plus a still-active legacy plan needs an import attempt. Transport or
 * server failure preserves that plan temporarily and leaves the bit false so a
 * later login/sync/refresh retries; every successful HTTP result is definitive.
 */
export async function resolveServerEntitlement(
  db: Db,
  serverEntitlement: ServerEntitlement,
  importLegacy: LegacyEntitlementImporter,
  now = Date.now(),
): Promise<Db> {
  const issuedAt = Date.parse(serverEntitlement.issuedAt);
  if (!Number.isFinite(issuedAt)) {
    return applyAuthoritative(db, serverEntitlement, now);
  }

  if (db.meta.legacyEntitlementMigrationResolved || serverEntitlement.status !== "none") {
    return applyAuthoritative(db, serverEntitlement, now);
  }

  if (!usableLegacy(db.subscription, issuedAt)) {
    return applyAuthoritative(db, serverEntitlement, now);
  }

  const local = db.subscription;
  try {
    const result = await importLegacy({
      planId: local.planId,
      expiresAt: local.expiresAt,
      startedAt: local.startedAt,
      trial: local.trial,
    });
    return applyAuthoritative(db, result.entitlement, now);
  } catch (error) {
    if (
      error instanceof ApiError &&
      !error.offline &&
      error.status > 0 &&
      error.status < 500 &&
      !RETRYABLE_CLIENT_STATUSES.has(error.status)
    ) {
      return applyAuthoritative(db, serverEntitlement, now);
    }

    // The server response still confirms clock state, but it did not settle the
    // legacy claim. Preserve only the existing bounded local value for offline,
    // transport, and server failures, then retry on a later response.
    return applyServerEntitlement(db, local, now);
  }
}
