/**
 * Device-local state — everything that must NOT sync between a user's devices.
 *
 * Stays in localStorage: it's tiny, it's read once on boot, and synchronous
 * access keeps the reminder scheduler simple. The bulk data lives in IndexedDB.
 */
import {
  defaultDb,
  type AppNotification,
  type Auth,
  type Db,
  type Settings,
  type Subscription,
} from "../store";
import { getActiveVaultId, LEGACY_VAULT_ID } from "./vault";

const LOCAL_KEY = "routino:local:v1";

function localKey(): string {
  const vaultId = getActiveVaultId();
  return vaultId === LEGACY_VAULT_ID ? LOCAL_KEY : `routino:local:v2:${vaultId}`;
}

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
  /** Every preference is device-local. Settings never enter IndexedDB's sync
   * outbox or the server records table. */
  settings: Settings;
}

const defaultSettings = (): Settings => defaultDb([]).settings;

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
    settings: defaultSettings(),
  };
}

export function loadLocal(): LocalState {
  try {
    const raw = localStorage.getItem(localKey());
    if (!raw) return defaultLocal();
    const parsed = JSON.parse(raw) as Partial<LocalState> & Partial<Settings>;
    const fresh = defaultLocal();
    const settings = {
      ...fresh.settings,
      ...parsed.settings,
      // One-time compatibility with the former flat local preference fields.
      ...(parsed.theme !== undefined ? { theme: parsed.theme } : {}),
      ...(parsed.notificationsEnabled !== undefined
        ? { notificationsEnabled: parsed.notificationsEnabled }
        : {}),
      ...(parsed.completionSoundEnabled !== undefined
        ? { completionSoundEnabled: parsed.completionSoundEnabled }
        : {}),
      ...(parsed.hapticsEnabled !== undefined ? { hapticsEnabled: parsed.hapticsEnabled } : {}),
    };
    return { ...fresh, ...parsed, settings, meta: { ...fresh.meta, ...parsed.meta } };
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
    settings: db.settings,
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
    prev.settings !== next.settings
  );
}
