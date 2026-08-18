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
import {
  clearTokens,
  entitlementToSubscription,
  fetchEntitlement,
  hasSession,
  loadTokens,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { fetchDevices } from "@/lib/api/devices";
import { todayKey, type Calendar, type Lang } from "@/lib/dates";
import { diffDb } from "@/lib/db/diff";
import { hydrate } from "@/lib/db/hydrate";
import { loadLocal, localChanged, mergeSettings, saveLocal, toLocalState } from "@/lib/db/local";
import { applyChanges } from "@/lib/db/persist";
import { switchOwnerVault } from "@/lib/db/vault";
import { DEFAULT_CATEGORIES } from "@/lib/presets";
import { defaultDb, uid, type Db } from "@/lib/store";
import { applyServerEntitlement, dueHabitsOn, isCompleted, getLog } from "@/lib/logic";
import {
  requestNativePermission,
  syncRecurringReminders,
  syncSubscriptionReminders,
} from "@/lib/native-notifications";
import { syncNativeBars } from "@/lib/native";
import { loginAs } from "@/lib/wipe";
import { decideSession, isSessionRevocationReason } from "@/lib/security-session";
import { subscriptionReminderEvents } from "@/lib/subscription-reminders";

type Updater = (fn: (db: Db) => Db) => void;

interface AppCtx {
  db: Db | null;
  update: Updater;
  switchAccount: (
    user: { id: string; phone: string },
    subscription: Db["subscription"],
  ) => Promise<void>;
  sessionGate: "ready" | "checking" | "needs-online";
  retrySession: () => Promise<void>;
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
  const [sessionGate, setSessionGate] = useState<AppCtx["sessionGate"]>("checking");
  const dbRef = useRef<Db | null>(null);
  dbRef.current = db;

  /** The last state written to storage; the diff baseline. */
  const lastPersisted = useRef<Db | null>(null);
  /** So a broken IndexedDB warns once, not on every keystroke. */
  const persistFailed = useRef(false);
  /** All IndexedDB writes are serialized so an account switch can wait until
   * the old vault is fully flushed before selecting the new one. */
  const persistQueue = useRef<Promise<void>>(Promise.resolve());
  const switchingVault = useRef(false);

  const update: Updater = useCallback((fn) => {
    setDb((prev) => (prev ? fn(prev) : prev));
  }, []);

  const switchAccount = useCallback(
    async (user: { id: string; phone: string }, subscription: Db["subscription"]) => {
      const current = dbRef.current;
      if (current) {
        await persistQueue.current;
        const pending = diffDb(lastPersisted.current, current);
        if (localChanged(lastPersisted.current, current)) saveLocal(toLocalState(current));
        if (pending.length) await applyChanges(pending);
      }

      switchingVault.current = true;
      try {
        await switchOwnerVault(user.id);
        const { db: loaded } = await hydrate();
        const next = loginAs(loaded, user.phone, subscription, Date.now(), user.id);
        next.notifications = [
          {
            id: uid(),
            title: next.settings.lang === "fa" ? "ورود امن ثبت شد" : "Secure sign-in recorded",
            body:
              next.settings.lang === "fa"
                ? "ورود این دستگاه به حسابت ثبت شد. اگر این دستگاه را نمی‌شناسی به @routino_support پیام بده."
                : "This device signed in to your account. If you do not recognize it, message @routino_support.",
            at: Date.now(),
            read: false,
          },
          ...next.notifications,
        ].slice(0, 100);
        saveLocal(toLocalState(next));
        lastPersisted.current = next;
        setDb(next);
        setSessionGate("ready");
      } finally {
        switchingVault.current = false;
      }
    },
    [],
  );

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
    if (!db || db === lastPersisted.current || switchingVault.current) return;
    const prev = lastPersisted.current;
    const changes = diffDb(prev, db);
    // Set before the await so a second update can't interleave and re-diff the
    // same changes.
    lastPersisted.current = db;
    if (localChanged(prev, db)) saveLocal(toLocalState(db));
    // Never awaited by the UI — but never silent either. A rejected write means
    // this change is gone (storage full, private-mode IndexedDB, a corrupted
    // profile), and the one thing worse than losing it is the user not knowing:
    // they would keep adding habits into a session that saves nothing.
    //
    // This used to point at Settings → Backup. That card is hidden behind
    // `BACKUP_UI` now, so the message names the causes the user can actually act
    // on instead of a button they will not find.
    if (changes.length) {
      const write = persistQueue.current.then(() => applyChanges(changes));
      persistQueue.current = write.catch(() => undefined);
      void write.catch((err) => {
        console.error("failed to persist changes", err);
        if (!persistFailed.current) {
          persistFailed.current = true;
          toast.error(
            db.settings.lang === "fa"
              ? "ذخیره‌سازی روی این دستگاه کار نمی‌کند و تغییرهای جدید از بین می‌رود. اگر مرورگر در حالت ناشناس است از آن خارج شو، وگرنه حافظهٔ دستگاه را خالی کن."
              : "Saving to this device is failing and new changes will be lost. Leave private/incognito mode if you are in it, otherwise free up device storage.",
            { duration: 15_000 },
          );
        }
      });
    }
  }, [db]);

  const checkingSession = useRef(false);
  const checkSession = useCallback(async () => {
    const current = dbRef.current;
    if (!current?.auth || checkingSession.current) return;
    const tokens = loadTokens();
    if (!tokens) {
      setDb((prev) => (prev ? { ...prev, auth: null } : prev));
      setSessionGate("ready");
      return;
    }

    checkingSession.current = true;
    try {
      await fetchDevices();
      setSessionGate("ready");
      void fetchEntitlement()
        .then(({ entitlement }) => {
          const sub = entitlementToSubscription(entitlement);
          if (sub) setDb((prev) => (prev ? applyServerEntitlement(prev, sub) : prev));
        })
        .catch(() => undefined);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      if (isSessionRevocationReason(code)) {
        clearTokens();
        setDb((prev) => {
          if (!prev) return prev;
          const fa = prev.settings.lang === "fa";
          return {
            ...prev,
            auth: null,
            notifications: [
              {
                id: uid(),
                title: fa ? "بررسی امنیت حساب" : "Account security check",
                body: fa
                  ? "نشست این دستگاه پایان یافت. اطلاعاتت روی این دستگاه باقی مانده؛ برای راهنمایی به @routino_support پیام بده."
                  : "This device session ended. Your local data is still here; message @routino_support for help.",
                at: Date.now(),
                read: false,
              },
              ...prev.notifications,
            ].slice(0, 100),
          };
        });
        setSessionGate("ready");
        return;
      }
      const latest = loadTokens() ?? tokens;
      const decision = decideSession({
        now: Date.now(),
        lastServerConfirmedAt: latest.lastServerConfirmedAt,
        online: navigator.onLine,
      });
      setSessionGate(decision.kind === "needs-online-confirmation" ? "needs-online" : "ready");
    } finally {
      checkingSession.current = false;
    }
  }, []);

  // Validate on boot, immediately when connectivity returns, whenever the app
  // comes to the foreground, and once a minute while it is visible. A closed web
  // app cannot execute code; the next open performs the same check before data UI.
  const sessionOwner = db?.auth?.userId ?? db?.auth?.phone ?? null;
  useEffect(() => {
    if (!sessionOwner) {
      setSessionGate("ready");
      return;
    }
    void checkSession();
    const onOnline = () => void checkSession();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void checkSession();
    }, 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, [sessionOwner, checkSession]);

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

  // Subscription reminders are local and idempotent. They fire on the first
  // open inside the three-day window and again after expiry, even if the exact
  // scheduled instant was missed while the web app was closed.
  useEffect(() => {
    const checkSubscription = () => {
      const cur = dbRef.current;
      if (!cur || !cur.settings.notificationsEnabled) return;
      const events = subscriptionReminderEvents(cur);
      if (!events.length) return;
      const fa = cur.settings.lang === "fa";
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const event of events) {
          try {
            new Notification(fa ? event.title.fa : event.title.en, {
              body: fa ? event.body.fa : event.body.en,
            });
          } catch {
            /* in-app notification below remains the guaranteed fallback */
          }
        }
      }
      setDb((prev) =>
        prev
          ? {
              ...prev,
              notifications: [
                ...events.map((event) => ({
                  id: uid(),
                  title: fa ? event.title.fa : event.title.en,
                  body: fa ? event.body.fa : event.body.en,
                  at: Date.now(),
                  read: false,
                })),
                ...prev.notifications,
              ].slice(0, 100),
              meta: {
                ...prev.meta,
                firedReminders: [...prev.meta.firedReminders, ...events.map((event) => event.key)].slice(-300),
              },
            }
          : prev,
      );
    };
    checkSubscription();
    const interval = setInterval(checkSubscription, 60 * 60_000);
    return () => clearInterval(interval);
  }, [db?.subscription?.expiresAt, db?.settings.notificationsEnabled]);

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
        if (granted) {
          syncRecurringReminders(db);
          syncSubscriptionReminders(db);
        }
      });
    } else {
      syncRecurringReminders(db); // will clear pending recurring notifications
      syncSubscriptionReminders(db);
    }
  }, [
    db?.settings.notificationsEnabled,
    db?.settings.journalReminder,
    db?.habits,
    db?.subscription?.expiresAt,
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
            ...newNotifs.map((n) => ({
              id: uid(),
              title: n.title,
              body: n.body,
              at: Date.now(),
              read: false,
            })),
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

  const value = useMemo<AppCtx>(
    () => ({ db, update, switchAccount, sessionGate, retrySession: checkSession, lang, cal, t }),
    [db, update, switchAccount, sessionGate, checkSession, lang, cal, t],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
