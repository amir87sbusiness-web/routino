import type { Db } from "./store";

export type AccessState =
  | "unauthenticated"
  | "checking"
  | "pretrial"
  | "active-trial"
  | "active-paid"
  | "expired"
  | "needs-online-verification";

/** The only access states that own a redirect outside the main app shell. */
export function accessRoute(state: AccessState): "/auth" | "/activation" | null {
  if (state === "unauthenticated") return "/auth";
  if (state === "pretrial") return "/activation";
  return null;
}

/**
 * Classifies app access without treating a missing or unverified entitlement as
 * eligibility for a trial. The server-owned entitlement bridge is settled only
 * once the vault-local legacy migration flag is true.
 */
export function accessState(
  db: Db | null,
  sessionGate: "ready" | "checking" | "needs-online",
  now = Date.now(),
): AccessState {
  if (!db || sessionGate === "checking") return "checking";
  if (!db.auth) return "unauthenticated";
  if (sessionGate === "needs-online" || db.meta.tampered) return "needs-online-verification";
  if (!db.meta.legacyEntitlementMigrationResolved) return "checking";
  if (!db.subscription) return "pretrial";
  if (db.subscription.expiresAt <= now) return "expired";
  return db.subscription.trial || db.subscription.planId === "trial"
    ? "active-trial"
    : "active-paid";
}

export function productWriteAllowed(
  db: Db | null,
  sessionGate: "ready" | "checking" | "needs-online",
  now = Date.now(),
): boolean {
  const state = accessState(db, sessionGate, now);
  return state === "active-trial" || state === "active-paid";
}
