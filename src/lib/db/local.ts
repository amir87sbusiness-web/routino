/**
 * Device-local state — everything that must NOT sync between a user's devices.
 *
 * Stays in localStorage: it's tiny, it's read once on boot, and synchronous
 * access keeps the reminder scheduler simple. The bulk data lives in IndexedDB.
 */
import type { AppNotification, Auth, Db, Settings, Subscription, ThemeMode } from "../store";

const LOCAL_KEY = "routino:local:v1";

/** Settings fields that belong to the account and follow the user across devices.
 * `onboarded` is here on purpose — it's what lets a second device skip onboarding. */
export const SYNCED_SETTING_KEYS = ["lang", "calendar", "brandColor", "onboarded", "journalReminder"] as const;

/** Settings fields that belong to the device, not the account:
 *  - `theme`: phone at night vs laptop in daylight are different contexts.
 *  - `notificationsEnabled`: flipping this true calls requestNativePermission();
 *    pulling `true` from a laptop would fire an unprompted permission dialog on
 *    the phone, and the laptop cannot grant permission on the phone's behalf. */
export const LOCAL_SETTING_KEYS = ["theme", "notificationsEnabled"] as const;

export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number];
export type LocalSettingKey = (typeof LOCAL_SETTING_KEYS)[number];

export interface LocalState {
  auth: Auth | null;
  /**
   * Not synced — the server becomes the authority here (Phase 5) — but it MUST
   * persist locally until then. Today it is the only record that a user has a
   * trial or a paid plan; dropping it locks every existing user out of the app
   * on their next launch. Phase 3 imports it to the server at login, and after
   * that the client only ever reads a server-issued entitlement.
   */
  subscription: Subscription | null;
  /** Generated on-device by the reminder scheduler from local reminders. */
  notifications: AppNotification[];
  /** `firedReminders`/`celebrated` are per-device by nature; `lastSeen`/`sessions`
   * describe this install, not the account. */
  meta: Db["meta"];
  theme: ThemeMode;
  notificationsEnabled: boolean;
}

export function defaultLocal(): LocalState {
  return {
    auth: null,
    subscription: null,
    notifications: [],
    meta: {
      sessions: 0,
      lastFeedbackSession: 0,
      lastSeen: Date.now(),
      tampered: false,
      celebrated: [],
      firedReminders: [],
      dataOwner: null,
    },
    theme: "light",
    notificationsEnabled: true,
  };
}

export function loadLocal(): LocalState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
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
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
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
  };
}

/** True when any device-local field differs by reference/value. Cheap enough to
 * run on every update: it's 5 comparisons, and the arrays are replaced (not
 * mutated) by every write path, so reference equality is a valid test. */
export function localChanged(prev: Db | null, next: Db): boolean {
  if (!prev) return true;
  return (
    prev.auth !== next.auth ||
    prev.subscription !== next.subscription ||
    prev.notifications !== next.notifications ||
    prev.meta !== next.meta ||
    prev.settings.theme !== next.settings.theme ||
    prev.settings.notificationsEnabled !== next.settings.notificationsEnabled
  );
}

/** Rebuilds the settings object from its synced and device-local halves. */
export function mergeSettings(synced: Partial<Settings>, local: LocalState, fallback: Settings): Settings {
  return {
    ...fallback,
    ...synced,
    theme: local.theme,
    notificationsEnabled: local.notificationsEnabled,
  };
}
