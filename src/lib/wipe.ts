/**
 * Content wipe + per-account data isolation.
 *
 * The rule that matters: local data belongs to ONE phone number
 * (`meta.dataOwner`). Signing out keeps the data — the same account signing
 * back in finds everything. A DIFFERENT phone signing in must never see the
 * previous owner's habits, so login goes through `loginAs`, which wipes
 * content on an owner change. The wipe runs through the normal `update()`
 * path, so `diffDb` tombstones every old record in IndexedDB.
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
 * The next state after `phone` signs in on this device.
 *
 * - First sign-in ever (`dataOwner` null): adopt whatever data exists. This is
 *   also the migration path for installs that predate `dataOwner`.
 * - Same phone as the owner: keep everything (sign-out → sign-in round trip).
 * - Different phone: wipe content AND drop the previous owner's subscription —
 *   an entitlement belongs to an account, not to the device. The caller passes
 *   the new account's server-issued subscription when it has one.
 *
 * A missing/empty `serverSubscription` falls back to the LOCAL subscription
 * only when the owner is unchanged — matching the long-standing rule that an
 * empty server answer must not wipe a legacy local subscription. On an owner
 * switch there is nothing safe to fall back to.
 */
export function loginAs(
  db: Db,
  phone: string,
  serverSubscription?: Subscription | null,
  now = Date.now(),
): Db {
  const switching = db.meta.dataOwner !== null && db.meta.dataOwner !== phone;
  const base = switching ? wipeContent(db) : db;
  return {
    ...base,
    auth: { phone, verifiedAt: now },
    subscription: serverSubscription ?? (switching ? null : db.subscription),
    meta: { ...base.meta, dataOwner: phone },
  };
}
