/**
 * Device-local state — everything that must NOT sync between a user's devices.
 *
 * Stays in localStorage: it's tiny, it's read once on boot, and synchronous
 * access keeps the reminder scheduler simple. The bulk data lives in IndexedDB.
 */
import type { AppNotification, Auth, Db, Settings, Subscription, ThemeMode } from "../store";
import { getActiveVaultId, LEGACY_VAULT_ID } from "./vault";

const LOCAL_KEY = "routino:local:v1";

function localKey(): string {
  const vaultId = getActiveVaultId();
  return vaultId === LEGACY_VAULT_ID ? LOCAL_KEY : `routino:local:v2:${vaultId}`;
}

/** Settings fields that belong to the account and follow the user across devices.
 * `onboarded` is here on purpose — it's what lets a second device skip onboarding. */
export const SYNCED_SETTING_KEYS = [
  "lang",
  "calendar",
  "brandColor",
  "onboarded",
  "journalReminder",
] as const;

/** Settings fields that belong to the device, not the account:
 *  - `theme`: phone at night vs laptop in daylight are different contexts.
 *  - `notificationsEnabled`: records device-local user intent after an explicit
 *    action; effective delivery still requires a separate OS permission check.
 *    pulling `true` from a laptop would fire an unprompted permission dialog on
 *    the phone, and the laptop cannot grant permission on the phone's behalf. */
export const LOCAL_SETTING_KEYS = [
  "theme",
  "notificationsEnabled",
  "completionSoundEnabled",
  "hapticsEnabled",
] as const;

export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number];
export type LocalSettingKey = (typeof LOCAL_SETTING_KEYS)[number];

export interface LocalState {
  auth: Auth | null;
  /**
   * Not synced — the server becomes the authority here (Phase 5) — but it MUST
   * persist locally until its bounded migration is resolved. Older installs may
   * still hold the only record of paid access here; after a definitive import
   * result, every server answer including `none` becomes authoritative.
   */
  subscription: Subscription | null;
  /** Generated on-device by the reminder scheduler from local reminders. */
  notifications: AppNotification[];
  /** `firedReminders`/`celebrated` are per-device by nature; `lastSeen`/`sessions`
   * describe this install, not the account. */
  meta: Db["meta"];
  theme: ThemeMode;
  notificationsEnabled: boolean;
  completionSoundEnabled: boolean;
  hapticsEnabled: boolean;
}

export function defaultLocal(): LocalState {
  return {
    auth: null,
    subscription: null,
    notifications: [],
    meta: {
      sessions: 0,
      lastFeedbackAt: 0,
      lastSeen: Date.now(),
      tampered: false,
      celebrated: [],
      firedReminders: [],
      legacyEntitlementMigrationResolved: false,
      dataOwner: null,
    },
    theme: "light",
    notificationsEnabled: false,
    completionSoundEnabled: true,
    hapticsEnabled: true,
  };
}

export function loadLocal(): LocalState {
  try {
    const raw = localStorage.getItem(localKey());
    if (!raw) return defaultLocal();
    const parsed = JSON.parse(raw) as Partial<LocalState>;
    const fresh = defaultLocal();
    return { ...fresh, ...parsed, meta: { ...fresh.meta, ...parsed.meta } };
  } catch {
    return defaultLocal();
  }
}

export function saveLocal(state: LocalState): void {
  try {
    localStorage.setItem(localKey(), JSON.stringify(state));
  } catch {
    // Storage full/unavailable — best effort, same as before.
  }
}

/** Pulls the device-local slice out of the in-memory Db for persistence. */
export function toLocalState(db: Db): LocalState {
  return {
    auth: db.auth,
    subscription: db.subscription,
    notifications: db.notifications,
    meta: db.meta,
    theme: db.settings.theme,
    notificationsEnabled: db.settings.notificationsEnabled,
    completionSoundEnabled: db.settings.completionSoundEnabled,
    hapticsEnabled: db.settings.hapticsEnabled,
  };
}

/** True when any device-local field differs by reference/value. Cheap enough to
 * run on every update: the local objects/arrays are replaced (not
 * mutated) by every write path, so reference equality is a valid test. */
export function localChanged(prev: Db | null, next: Db): boolean {
  if (!prev) return true;
  return (
    prev.auth !== next.auth ||
    prev.subscription !== next.subscription ||
    prev.notifications !== next.notifications ||
    prev.meta !== next.meta ||
    prev.settings.theme !== next.settings.theme ||
    prev.settings.notificationsEnabled !== next.settings.notificationsEnabled ||
    prev.settings.completionSoundEnabled !== next.settings.completionSoundEnabled ||
    prev.settings.hapticsEnabled !== next.settings.hapticsEnabled
  );
}

/** Rebuilds the settings object from its synced and device-local halves. */
export function mergeSettings(
  synced: Partial<Settings>,
  local: LocalState,
  fallback: Settings,
): Settings {
  return {
    ...fallback,
    ...synced,
    theme: local.theme,
    notificationsEnabled: local.notificationsEnabled,
    completionSoundEnabled: local.completionSoundEnabled,
    hapticsEnabled: local.hapticsEnabled,
  };
}
