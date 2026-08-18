export const ENTITLEMENT_REFRESH_MS = 6 * 60 * 60 * 1000;
export const ENTITLEMENT_EXPIRY_REFRESH_MS = 60 * 60 * 1000;
const EXPIRY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

interface EntitlementRefreshInput {
  now: number;
  lastCheckedAt?: number;
  expiresAt?: number | null;
  force?: boolean;
}

/**
 * Device security is checked frequently, but subscription state changes much
 * less often. Keeping those cadences separate avoids an unnecessary database
 * read on every security ping while still tightening checks near expiry.
 */
export function shouldRefreshEntitlement({
  now,
  lastCheckedAt,
  expiresAt,
  force = false,
}: EntitlementRefreshInput): boolean {
  if (force || !Number.isFinite(lastCheckedAt)) return true;
  if (now < (lastCheckedAt as number)) return true;

  const nearExpiry = Number.isFinite(expiresAt) && (expiresAt as number) - now <= EXPIRY_WINDOW_MS;
  const interval = nearExpiry ? ENTITLEMENT_EXPIRY_REFRESH_MS : ENTITLEMENT_REFRESH_MS;
  return now - (lastCheckedAt as number) >= interval;
}
