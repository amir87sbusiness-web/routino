/**
 * Explicit content erase helpers.
 *
 * Account isolation is implemented by separate IndexedDB vaults in
 * `db/vault.ts`. Login must never erase a vault: switching accounts selects a
 * different database, while this module is reserved for a user's explicit
 * “erase data on this device” action.
 */
import { DEFAULT_CATEGORIES } from "./presets";
import { defaultDb, type Db, type Subscription } from "./store";

/**
 * Drops everything the user created — habits, logs, tasks, timer history,
 * journal, feedback, notifications, celebration/reminder bookkeeping — and
 * reseeds the default categories. KEEPS the account (`auth`), the
 * `subscription`, and all settings (language, theme, onboarded…): wiping data
 * is not signing out.
 */
export function wipeContent(db: Db): Db {
  const fresh = defaultDb(DEFAULT_CATEGORIES);
  return {
    ...db,
    categories: fresh.categories,
    habits: [],
    logs: {},
    tasks: [],
    timerSessions: [],
    journal: {},
    feedback: [],
    notifications: [],
    meta: { ...db.meta, celebrated: [], firedReminders: [] },
  };
}

/**
 * Applies identity and entitlement to the vault already selected for this
 * account. It deliberately never changes product content.
 */
export function loginAs(
  db: Db,
  phone: string,
  serverSubscription?: Subscription | null,
  now = Date.now(),
  userId?: string,
): Db {
  return {
    ...db,
    auth: { userId, phone, verifiedAt: now },
    subscription: serverSubscription ?? db.subscription,
    meta: { ...db.meta, dataOwner: phone },
  };
}
