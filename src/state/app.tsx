/**
 * Global app provider: hydrates the local DB (offline-first), exposes update(),
 * applies theme/dir/brand color, runs the reminder scheduler and anti
 * clock-tampering guard.
 *
 * Persistence is an effect, not part of `update()`. Two consequences worth
 * knowing:
 *  - `update()` stays pure, so React can invoke it during render and
 *    double-invoke it under StrictMode without writing anything twice.
 *  - Writes are fire-and-forget, so the UI never awaits storage. That is what
 *    makes offline indistinguishable from online, structurally rather than by
 *    discipline.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { entitlementToSubscription, fetchEntitlement, hasSession } from "@/lib/api/auth";
import { todayKey, type Calendar, type Lang } from "@/lib/dates";
import { diffDb } from "@/lib/db/diff";
import { hydrate } from "@/lib/db/hydrate";
import { loadLocal, localChanged, mergeSettings, saveLocal, toLocalState } from "@/lib/db/local";
import { applyChanges } from "@/lib/db/persist";
import { DEFAULT_CATEGORIES } from "@/lib/presets";
import { defaultDb, uid, type Db } from "@/lib/store";
import { applyServerEntitlement, dueHabitsOn, isCompleted, getLog } from "@/lib/logic";
import { requestNativePermission, syncRecurringReminders } from "@/lib/native-notifications";
import { syncNativeBars } from "@/lib/native";

type Updater = (fn: (db: Db) => Db) => void;

interface AppCtx {
  db: Db | null;
  update: Updater;
  lang: Lang;
  cal: Calendar;
  t: (fa: string, en: string) => string;
}

const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx & { db: Db } {
  const ctx = useContext(Ctx);
  if (!ctx || !ctx.db) throw new Error("useApp must be used under a loaded AppProvider");
  return ctx as AppCtx & { db: Db };
}

export function useAppMaybe() {
  return useContext(Ctx);
}

/**
 * How far the clock may jump BACKWARDS before we treat it as tampering.
 *
 * Was 5 minutes, which punished honest devices: a phone that has been off, in
 * airplane mode, or without signal for a while can correct by far more than
 * that the moment it syncs, and the penalty is severe — `tampered` is sticky,
 * `subscriptionActive()` goes false, and a paying user is thrown at the paywall
 * until a server answer arrives to clear it.
 *
 * 6 hours costs an attacker essentially nothing that mattered: stretching an
 * expired subscription needs the clock wound back by days or weeks, which is far
 * past this bound and still caught. The server-issued entitlement is the real
 * defence; this is only a local tripwire.
 */
const TAMPER_TOLERANCE = 6 * 60 * 60 * 1000;

export function AppProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const dbRef = useRef<Db | null>(null);
  dbRef.current = db;

  /** The last state written to storage; the diff baseline. */
  const lastPersisted = useRef<Db | null>(null);
  /** So a broken IndexedDB warns once, not on every keystroke. */
  const persistFailed = useRef(false);

  const update: Updater = useCallback((fn) => {
    setDb((prev) => (prev ? fn(prev) : prev));
  }, []);

  // Hydrate on mount (client only). AppShell already renders a splash while
  // `db` is null, which covers the async gap.
  useEffect(() => {
    let cancelled = false;
    const apply = (loaded: Db) => {
      if (cancelled) return;
      const now = Date.now();
      // anti clock-tampering: system clock moved backwards past last-seen
      const tampered = now < loaded.meta.lastSeen - TAMPER_TOLERANCE;
      lastPersisted.current = loaded; // baseline: what's already on disk
      setDb({
        ...loaded,
        meta: {
          ...loaded.meta,
          sessions: loaded.meta.sessions + 1,
          lastSeen: Math.max(now, loaded.meta.lastSeen),
          tampered: tampered || loaded.meta.tampered,
          // Migration for installs that predate per-account isolation: the data
          // on this device belongs to whoever is signed in right now.
          dataOwner: loaded.meta.dataOwner ?? loaded.auth?.phone ?? null,
        },
      });
    };
    hydrate()
      .then(({ db: loaded }) => apply(loaded))
      .catch(() => {
        // IndexedDB refused to open (rare: private mode, corrupted profile).
        // Without this the app would sit on the splash screen forever. Boot
        // from the localStorage slice + defaults instead: the session is
        // memory-only for bulk data, but the user can still get in — and still
        // export a backup of whatever this fallback could recover.
        const local = loadLocal();
        const fresh = defaultDb(DEFAULT_CATEGORIES);
        apply({
          ...fresh,
          settings: mergeSettings({}, local, fresh.settings),
          auth: local.auth,
          subscription: local.subscription,
          notifications: local.notifications,
          meta: local.meta,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist whatever changed since the last write. Diffing against
  // `lastPersisted` rather than the previous render lets React's batching
  // coalesce several updates into one diff — fewer writes, same result.
  useEffect(() => {
    if (!db || db === lastPersisted.current) return;
    const prev = lastPersisted.current;
    const changes = diffDb(prev, db);
    // Set before the await so a second update can't interleave and re-diff the
    // same changes.
    lastPersisted.current = db;
    if (localChanged(prev, db)) saveLocal(toLocalState(db));
    // Never awaited by the UI — but never silent either. A rejected write means
    // this change is gone (storage full, private-mode IndexedDB, a corrupted
    // profile), and the one thing worse than losing it is the user not knowing:
    // they would keep adding habits into a session that saves nothing. Told
    // once, they can export a backup while the data is still in memory.
    if (changes.length) {
      void applyChanges(changes).catch((err) => {
        console.error("failed to persist changes", err);
        if (!persistFailed.current) {
          persistFailed.current = true;
          toast.error(
            db.settings.lang === "fa"
              ? "ذخیره‌سازی روی این دستگاه کار نمی‌کند. از «تنظیمات ← پشتیبان‌گیری» یک نسخه بگیر."
              : "Saving to this device is failing. Export a backup from Settings → Backup.",
            { duration: 15_000 },
          );
        }
      });
    }
  }, [db]);

  // Refresh the entitlement cache from the server once per app start.
  // The paywall gates on the LOCAL `db.subscription`; this keeps that local
  // copy honest (a payment made on another device, an admin grant, an expiry).
  // Offline or signed-out: silently keep whatever we have — offline must stay
  // indistinguishable from online.
  const entitlementFetched = useRef(false);
  const entitlementRetryAfter = useRef(0);
  useEffect(() => {
    if (!db || entitlementFetched.current || !hasSession()) return;
    // Latching only on SUCCESS is load-bearing. This used to set the flag before
    // awaiting, so a single failed request — one dropped connection at launch —
    // burned the only attempt of the whole session. That is worst for the users
    // who need it most: a server answer is the ONLY thing that clears
    // `meta.tampered`, and while that flag is set `subscriptionActive` is false,
    // so a paying customer whose phone clock drifted backwards stayed locked out
    // of the app until they fully restarted it, even once they were back online.
    //
    // The cooldown is what keeps the retry from becoming a storm: this effect
    // re-runs on every `db` change, and the 60s heartbeat guarantees one.
    if (Date.now() < entitlementRetryAfter.current) return;
    entitlementRetryAfter.current = Date.now() + 60_000;
    void fetchEntitlement()
      .then(({ entitlement }) => {
        entitlementFetched.current = true;
        const sub = entitlementToSubscription(entitlement);
        // `none` (null) is NOT applied: a legacy local subscription that hasn't
        // been imported yet must not be wiped by an empty server answer.
        if (!sub) return;
        // Clears `meta.tampered` and re-baselines the clock guard — see
        // `applyServerEntitlement` for why both halves are load-bearing.
        setDb((prev) => (prev ? applyServerEntitlement(prev, sub) : prev));
      })
      .catch(() => {
        /* offline or expired session — the local cache stays authoritative,
           and the next heartbeat retries once the cooldown lapses */
      });
  }, [db]);

  // heartbeat: keep lastSeen fresh so the clock-tampering guard stays accurate.
  // `meta` is device-local, so this touches localStorage only — it no longer
  // rewrites the entire database every 60 seconds.
  useEffect(() => {
    const iv = setInterval(() => {
      setDb((prev) => {
        if (!prev) return prev;
        const now = Date.now();
        const tampered = now < prev.meta.lastSeen - TAMPER_TOLERANCE;
        if (prev.meta.lastSeen >= now && !tampered) return prev;
        return {
          ...prev,
          meta: {
            ...prev.meta,
            lastSeen: Math.max(now, prev.meta.lastSeen),
            tampered: prev.meta.tampered || tampered,
          },
        };
      });
    }, 60_000);
    return () => clearInterval(iv);
  }, []);

  // apply theme / dir / lang / brand color
  useEffect(() => {
    if (!db) return;
    const el = document.documentElement;
    const isDark = db.settings.theme === "dark";
    el.classList.toggle("dark", isDark);
    // نوارهای سیستمِ نیتیو را با تم هماهنگ کن (روی وب no-op).
    syncNativeBars(isDark);
    el.dir = db.settings.lang === "fa" ? "rtl" : "ltr";
    el.lang = db.settings.lang;
    if (db.settings.brandColor) {
      el.style.setProperty("--primary", db.settings.brandColor);
      el.style.setProperty("--ring", db.settings.brandColor);
    } else {
      el.style.removeProperty("--primary");
      el.style.removeProperty("--ring");
    }
  }, [db?.settings.theme, db?.settings.lang, db?.settings.brandColor, db]);

  // native reminder scheduling (Capacitor only; no-op on web).
  // Re-syncs whenever notification settings, habit reminder times, or the
  // journal reminder change, so the OS-level schedule always matches the DB.
  useEffect(() => {
    if (!db) return;
    if (db.settings.notificationsEnabled) {
      requestNativePermission().then((granted) => {
        if (granted) syncRecurringReminders(db);
      });
    } else {
      syncRecurringReminders(db); // will clear pending recurring notifications
    }
  }, [
    db?.settings.notificationsEnabled,
    db?.settings.journalReminder,
    db?.habits,
  ]);

  // reminder scheduler (habits, tasks, journal) — checks every 30s.
  // Kept as-is: this still drives in-app/foreground browser notifications on
  // web, and continues to populate the in-app notification center/history on
  // native too. The native OS-level alarms above are what fire when the
  // native app is backgrounded or closed.
  useEffect(() => {
    const check = () => {
      const cur = dbRef.current;
      if (!cur || !cur.settings.notificationsEnabled || !cur.auth) return;
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const dk = todayKey();
      const fired = new Set(cur.meta.firedReminders);
      const newNotifs: { title: string; body: string }[] = [];
      const newFired: string[] = [];
      const fa = cur.settings.lang === "fa";
      const cal = cur.settings.calendar;

      for (const h of dueHabitsOn(cur, dk, cal)) {
        if (!h.reminderTime || h.reminderTime !== hhmm) continue;
        if (isCompleted(h, getLog(cur, h.id, dk))) continue;
        const k = `habit|${h.id}|${dk}|${hhmm}`;
        if (fired.has(k)) continue;
        newFired.push(k);
        newNotifs.push({
          title: fa ? "یادآوری عادت" : "Habit reminder",
          body: fa ? `وقتشه: ${h.name}` : `Time for: ${h.name}`,
        });
      }
      for (const task of cur.tasks) {
        if (!task.reminderAt || task.done) continue;
        const rt = new Date(task.reminderAt);
        if (Math.abs(rt.getTime() - now.getTime()) > 45_000) continue;
        const k = `task|${task.id}`;
        if (fired.has(k)) continue;
        newFired.push(k);
        newNotifs.push({
          title: fa ? "یادآوری کار" : "Task reminder",
          body: task.title,
        });
      }
      if (cur.settings.journalReminder === hhmm) {
        const k = `journal|${dk}|${hhmm}`;
        if (!fired.has(k) && !cur.journal[dk]?.text) {
          newFired.push(k);
          newNotifs.push({
            title: fa ? "ژورنال روتینو" : "Routino Journal",
            body: fa ? "وقت ژورنال‌نویسیه ✍️" : "Time to write your journal ✍️",
          });
        }
      }
      if (newNotifs.length === 0) return;
      // browser notifications (best-effort)
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const n of newNotifs) {
          try {
            new Notification(n.title, { body: n.body });
          } catch {
            /* unsupported */
          }
        }
      }
      // No write here: the persist effect picks this up. Both `notifications`
      // and `meta.firedReminders` are device-local, so it lands in localStorage
      // rather than touching the database.
      setDb((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          notifications: [
            ...newNotifs.map((n) => ({ id: uid(), title: n.title, body: n.body, at: Date.now(), read: false })),
            ...prev.notifications,
          ].slice(0, 100),
          meta: {
            ...prev.meta,
            firedReminders: [...prev.meta.firedReminders, ...newFired].slice(-300),
          },
        };
      });
    };
    const iv = setInterval(check, 30_000);
    check();
    return () => clearInterval(iv);
  }, []);

  const lang: Lang = db?.settings.lang ?? "fa";
  const cal: Calendar = db?.settings.calendar ?? "jalali";

  const t = useCallback((faStr: string, enStr: string) => (lang === "fa" ? faStr : enStr), [lang]);

  const value = useMemo<AppCtx>(() => ({ db, update, lang, cal, t }), [db, update, lang, cal, t]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
