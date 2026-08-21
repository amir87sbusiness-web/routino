/**
 * Routino domain types — the shape of the in-memory application state.
 *
 * This is the contract the whole UI reads and writes; every mutation goes
 * through AppProvider's `update()`. Persistence lives in `lib/db/` and is
 * deliberately invisible from here: `Db` is the same object it always was, so
 * the storage layer could be swapped underneath without touching UI code.
 */
import type { Calendar, Lang } from "./dates";

export type ThemeMode = "light" | "dark";
export type MeasureType = "binary" | "quantity";

export interface Settings {
  lang: Lang;
  calendar: Calendar;
  theme: ThemeMode;
  brandColor: string; // any CSS color
  onboarded: boolean;
  journalReminder: string | null; // "HH:MM"
  notificationsEnabled: boolean;
  /** Device-local completion preferences; never emitted to sync. */
  completionSoundEnabled: boolean;
  hapticsEnabled: boolean;
}

export interface Auth {
  /** Stable server id used only to select this account's opaque local vault. */
  userId?: string;
  phone: string;
  verifiedAt: number;
}

export interface Subscription {
  planId: string;
  startedAt: number;
  expiresAt: number;
  trial?: boolean;
  pricePaid?: number;
}

export interface Category {
  id: string;
  nameFa: string;
  nameEn: string;
  color: string;
  icon: string; // lucide icon key
  isDefault: boolean;
  isLimit?: boolean;
}

export type ScheduleKind = "daily" | "odd" | "even" | "weekdays";

/** How a "quantity" habit's amount is entered: a free count+unit (e.g. "8 glasses")
 * or a duration, always internally stored/tracked in minutes (e.g. "30 min study"). */
export type UnitKind = "count" | "time";

export interface Habit {
  id: string;
  name: string;
  categoryId: string;
  type: MeasureType;
  target: number; // 1 for binary; for quantity+time this is TOTAL MINUTES
  unit?: string;
  unitKind?: UnitKind; // "count" | "time" — only meaningful when type === "quantity"
  schedule: { kind: ScheduleKind; weekdays?: number[] }; // weekdays: JS getDay()
  monthlyGoal: number | null; // days per month; null = all due days
  reminderTime: string | null; // "HH:MM"
  createdAt: number;
  archived?: boolean;
}

export interface HabitLog {
  habitId: string;
  dateKey: string;
  value: number;
  done: boolean;
  note?: string;
  mood?: string;
}

export interface Task {
  id: string;
  dateKey: string;
  title: string;
  type: MeasureType;
  target: number; // for quantity+time this is TOTAL MINUTES
  value: number;
  done: boolean;
  note?: string;
  unitKind?: UnitKind; // "count" | "time" — only meaningful when type === "quantity"
  reminderAt?: string | null; // ISO datetime-local
  color?: string; // hex, chosen from CATEGORY_COLOR_CHOICES
  icon?: string; // key from CATEGORY_ICONS
}

export type TimerMode = "pomodoro" | "free" | "stopwatch";

/** A completed/stopped timer session, logged for history + linking to a habit/task. */
export interface TimerSession {
  id: string;
  mode: TimerMode;
  focusSeconds: number; // actual counted work time (breaks excluded for pomodoro)
  startedAt: number;
  endedAt: number;
  linkedKind?: "habit" | "task";
  linkedId?: string;
  linkedLabel?: string;
}

export interface JournalEntry {
  dateKey: string;
  text: string;
  score: number | null; // 1..10
  mood: string | null;
  updatedAt: number;
}

export interface Feedback {
  id: string;
  rating: number; // 1..5
  section?: string;
  comment?: string;
  at: number;
  phone?: string;
}

export interface Plan {
  id: string;
  nameFa: string;
  nameEn: string;
  months: number;
  price: number; // toman
}

export interface Discount {
  code: string;
  percent: number;
  phone?: string; // restricted to one user
  active: boolean;
}

export interface Offer {
  label: string;
  percent: number;
  until: number; // timestamp
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
}

export interface Db {
  version: number;
  settings: Settings;
  auth: Auth | null;
  subscription: Subscription | null;
  categories: Category[];
  habits: Habit[];
  logs: Record<string, HabitLog>; // `${habitId}|${dateKey}`
  tasks: Task[];
  timerSessions: TimerSession[];
  journal: Record<string, JournalEntry>; // dateKey
  feedback: Feedback[];
  notifications: AppNotification[];
  meta: {
    sessions: number;
    /**
     * When the feedback popup was last dismissed or answered (epoch ms).
     *
     * The popup used to fire every 5 `sessions`, but a session is one app BOOT,
     * and on the web every reload is a boot — so a normal day of use produced it
     * repeatedly. Time is the honest unit for "don't nag me". `0` means never
     * asked, so an existing install sees it once and then falls into the rhythm.
     */
    lastFeedbackAt: number;
    lastSeen: number; // anti clock-tampering
    tampered: boolean;
    celebrated: string[]; // `${habitId}|${monthKey}|${milestone}`
    firedReminders: string[]; // `${kind}|${id}|${dateKey}|${HH:MM}`
    /** Device/vault-local bridge for the one-time legacy subscription import.
     * Once true, every server entitlement including `none` is authoritative. */
    legacyEntitlementMigrationResolved: boolean;
    /** Phone that owns the data on this device. Survives sign-out so the SAME
     * account logging back in finds everything; a DIFFERENT phone signing in
     * triggers a content wipe (see lib/wipe.ts) so accounts never mix. */
    dataOwner: string | null;
  };
}

export const logKey = (habitId: string, dk: string) => `${habitId}|${dk}`;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const STORAGE_KEY = "routino:v1";

export function defaultDb(categories: Category[]): Db {
  return {
    version: 1,
    settings: {
      lang: "fa",
      calendar: "jalali",
      theme: "light",
      brandColor: "",
      onboarded: false,
      journalReminder: "22:00",
      notificationsEnabled: false,
      completionSoundEnabled: true,
      hapticsEnabled: true,
    },
    auth: null,
    subscription: null,
    categories,
    habits: [],
    logs: {},
    tasks: [],
    timerSessions: [],
    journal: {},
    feedback: [],
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
  };
}

/* `loadDb`/`saveDb` are gone. Storage now lives in `lib/db/`:
 *   hydrate()  — rebuilds this shape from IndexedDB + the device-local slice
 *   diffDb()   — works out what changed
 *   applyChanges() — writes only those records
 * The legacy blob under STORAGE_KEY is imported once by `db/migrate.ts` and then
 * deliberately left on disk as a recovery path. */
