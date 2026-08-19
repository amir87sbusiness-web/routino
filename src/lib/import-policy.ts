import { subscriptionActive } from "./logic";
import type { Db } from "./store";

/** Import is a paid-plan feature. Export intentionally has no matching gate. */
export function canImportBackup(db: Db, now = Date.now()): boolean {
  const subscription = db.subscription;
  if (!subscription || subscription.trial || subscription.planId === "free") return false;
  return subscriptionActive(db, now);
}
