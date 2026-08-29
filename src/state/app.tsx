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
  fetchEntitlement,
  importSubscription,
  loadTokens,
  markEntitlementChecked,
  sessionUserId,
  type ServerEntitlement,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { todayKey, type Calendar, type Lang } from "@/lib/dates";
import { diffDb } from "@/lib/db/diff";
import { hydrate } from "@/lib/db/hydrate";
import { loadLocal, localChanged, saveLocal, toLocalState } from "@/lib/db/local";
import { applyChanges } from "@/lib/db/persist";
import { switchOwnerVault } from "@/lib/db/vault";
import { resolveServerEntitlement } from "@/lib/entitlement-migration";
import { DEFAULT_CATEGORIES } from "@/lib/presets";
import {
  defaultDb,
  uid,
  type Category,
  type Db,
  type Feedback,
  type Habit,
  type Settings,
  type Subscription,
} from "@/lib/store";
import { applyServerEntitlement, dueHabitsOn, isCompleted, getLog } from "@/lib/logic";
import { productWriteAllowed } from "@/lib/access-state";
import { isNativeRuntime, reconcileNativeReminders } from "@/lib/native-notifications";
import { syncNativeBars } from "@/lib/native";
import { loginAs, wipeContent } from "@/lib/wipe";
import { decideSession } from "@/lib/security-session";
import { subscriptionReminderEvents } from "@/lib/subscription-reminders";
import { shouldRefreshEntitlement } from "@/lib/entitlement-refresh";
import { syncNow } from "@/lib/sync/engine";

type Updater = (fn: (db: Db) => Db) => boolean;
type PreferencePatch = Partial<
  Pick<
    Settings,
    | "lang"
    | "calendar"
    | "theme"
    | "brandColor"
    | "notificationsEnabled"
    | "completionSoundEnabled"
    | "hapticsEnabled"
    | "onboarded"
  >
>;

interface AppCtx {
  db: Db | null;
  update: Updater;
  requestProductWrite: () => boolean;
  updatePreferences: (patch: PreferencePatch) => void;
  applyEntitlement: (subscription: Subscription) => void;
  commitTrialActivation: (
    subscription: Subscription,
    habit: Habit | null,
    category?: Category,
  ) => void;
  markNotificationsRead: () => void;
  submitFeedback: (feedback: Feedback) => void;
  recordFeedbackPrompt: () => void;
  signOutLocal: () => void;
  signInLocal: (phone: string, subscription: Subscription | null) => void;
  resetSyncedContent: () => void;
  writeBlocked: boolean;
  clearWriteBlocked: () => void;
  switchAccount: (
    user: { id: string; phone: string },
    entitlement: ServerEntitlement,
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
const SYNC_DEBOUNCE_MS = 600;
const VISIBLE_SYNC_INTERVAL_MS = 10 * 60_000;
const RECONCILE_ATTEMPTS = 2;

function syncOwnerOf(value: Db | null): string | null {
  if (!value?.auth) return null;
  // Sessions written by current builds always carry userId. The JWT subject is
  // the migration bridge for older local auth blobs; a phone is never used as
  // the owner of a server cursor.
  return value.auth.userId ?? sessionUserId();
}

interface AppSyncResult {
  entitlementChecked: boolean;
}

interface ActiveAppSync {
  owner: string;
  promise: Promise<AppSyncResult>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [sessionGate, setSessionGate] = useState<AppCtx["sessionGate"]>("checking");
  const [writeBlocked, setWriteBlocked] = useState(false);
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
  const mutationRevision = useRef(0);
  const activeSync = useRef<ActiveAppSync | null>(null);
  const lastSyncAt = useRef(new Map<string, number>());
  const syncDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReconcile = useRef<{
    owner: string;
    entitlement: ServerEntitlement;
  } | null>(null);
  const sessionGateRef = useRef(sessionGate);
  sessionGateRef.current = sessionGate;

  const commitSystemUpdate = useCallback((fn: (db: Db) => Db) => {
    // Increment when the mutation is REQUESTED, not when React eventually runs
    // the state updater. This closes the race where a queued functional update
    // could otherwise be replaced by an already-hydrated remote snapshot.
    mutationRevision.current += 1;
    setDb((prev) => (prev ? fn(prev) : prev));
  }, []);

  const requestProductWrite = useCallback(() => {
    if (productWriteAllowed(dbRef.current, sessionGate)) return true;
    setWriteBlocked(true);
    return false;
  }, [sessionGate]);

  const update: Updater = useCallback(
    (fn) => {
      if (!requestProductWrite()) return false;
      // Re-check against the freshest React value so an entitlement expiring
      // between the click and the queued updater never gains a write.
      mutationRevision.current += 1;
      setDb((prev) => (productWriteAllowed(prev, sessionGate) ? fn(prev!) : prev));
      return true;
    },
    [requestProductWrite, sessionGate],
  );

  const updatePreferences = useCallback(
    (patch: PreferencePatch) => {
      commitSystemUpdate((current) => ({
        ...current,
        settings: { ...current.settings, ...patch },
      }));
    },
    [commitSystemUpdate],
  );

  const applyEntitlement = useCallback(
    (subscription: Subscription) => {
      commitSystemUpdate((current) => applyServerEntitlement(current, subscription));
    },
    [commitSystemUpdate],
  );

  const commitTrialActivation = useCallback(
    (subscription: Subscription, habit: Habit | null, category?: Category) => {
      commitSystemUpdate((current) => {
        const entitled = applyServerEntitlement(current, subscription);
        if (!habit) return entitled;
        return {
          ...entitled,
          categories:
            category && !entitled.categories.some((item) => item.id === category.id)
              ? [...entitled.categories, category]
              : entitled.categories,
          habits: [...entitled.habits, habit],
        };
      });
    },
    [commitSystemUpdate],
  );

  const markNotificationsRead = useCallback(() => {
    commitSystemUpdate((current) => ({
      ...current,
      notifications: current.notifications.map((notification) => ({ ...notification, read: true })),
    }));
  }, [commitSystemUpdate]);

  const submitFeedback = useCallback(
    (feedback: Feedback) => {
      commitSystemUpdate((current) => ({
        ...current,
        feedback: [
          { ...feedback, phone: feedback.phone ?? current.auth?.phone },
          ...current.feedback,
        ],
      }));
    },
    [commitSystemUpdate],
  );

  const recordFeedbackPrompt = useCallback(() => {
    commitSystemUpdate((current) => ({
      ...current,
      meta: { ...current.meta, lastFeedbackAt: Date.now() },
    }));
  }, [commitSystemUpdate]);

  const signOutLocal = useCallback(() => {
    commitSystemUpdate((current) => ({ ...current, auth: null }));
  }, [commitSystemUpdate]);

  const signInLocal = useCallback(
    (phone: string, subscription: Subscription | null) => {
      commitSystemUpdate((current) => loginAs(current, phone, subscription));
    },
    [commitSystemUpdate],
  );

  const resetSyncedContent = useCallback(() => {
    commitSystemUpdate(wipeContent);
  }, [commitSystemUpdate]);

  const clearWriteBlocked = useCallback(() => setWriteBlocked(false), []);

  const applyEntitlementToLiveState = useCallback(
    async (owner: string, entitlement: ServerEntitlement) => {
      const current = dbRef.current;
      if (!current || switchingVault.current || syncOwnerOf(current) !== owner) return false;
      const resolved = await resolveServerEntitlement(current, entitlement, (subscription) =>
        importSubscription(subscription, owner),
      );
      if (switchingVault.current || syncOwnerOf(dbRef.current) !== owner) return false;

      setDb((prev) => {
        if (!prev || syncOwnerOf(prev) !== owner) return prev;
        // Resolution changes only vault-local entitlement metadata. Merge those
        // fields into the latest React state so habits/tasks edited while the
        // import request was in flight are never replaced by an older snapshot.
        const next = {
          ...prev,
          subscription: resolved.subscription,
          meta: {
            ...prev.meta,
            tampered: resolved.meta.tampered,
            lastSeen: resolved.meta.lastSeen,
            legacyEntitlementMigrationResolved: resolved.meta.legacyEntitlementMigrationResolved,
          },
        };
        dbRef.current = next;
        return next;
      });
      return true;
    },
    [],
  );

  const reconcileRemote = useCallback(
    async (owner: string, entitlement?: ServerEntitlement): Promise<boolean> => {
      if (entitlement) pendingReconcile.current = { owner, entitlement };

      for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
        await persistQueue.current;
        if (switchingVault.current || syncOwnerOf(dbRef.current) !== owner) {
          pendingReconcile.current = null;
          return false;
        }

        const revision = mutationRevision.current;
        const { db: candidate } = await hydrate();
        if (
          switchingVault.current ||
          syncOwnerOf(dbRef.current) !== owner ||
          mutationRevision.current !== revision
        ) {
          // Let React commit the newer update and its persistence effect enqueue
          // the corresponding IndexedDB write before taking another snapshot.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          continue;
        }

        const pending = pendingReconcile.current?.owner === owner ? pendingReconcile.current : null;
        const authoritative = pending
          ? await resolveServerEntitlement(candidate, pending.entitlement, (subscription) =>
              importSubscription(subscription, owner),
            )
          : candidate;
        if (
          switchingVault.current ||
          syncOwnerOf(dbRef.current) !== owner ||
          mutationRevision.current !== revision
        ) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          continue;
        }
        if (localChanged(candidate, authoritative)) saveLocal(toLocalState(authoritative));
        // This assignment is deliberately before setDb: otherwise the normal
        // persistence effect would read the remote snapshot as a local edit and
        // mark every pulled row dirty again.
        lastPersisted.current = authoritative;
        dbRef.current = authoritative;
        if (pendingReconcile.current === pending) pendingReconcile.current = null;
        setDb(authoritative);
        return true;
      }

      return false;
    },
    [],
  );

  const syncAccount = useCallback(
    function run(owner: string, force = false): Promise<AppSyncResult> {
      const current = activeSync.current;
      if (current?.owner === owner) return current.promise;
      if (current) {
        return current.promise.then(
          () => run(owner, force),
          () => run(owner, force),
        );
      }

      const promise = (async (): Promise<AppSyncResult> => {
        if (switchingVault.current || syncOwnerOf(dbRef.current) !== owner) {
          return { entitlementChecked: false };
        }

        const last = lastSyncAt.current.get(owner) ?? 0;
        const pending = pendingReconcile.current;
        if (!force && Date.now() - last < VISIBLE_SYNC_INTERVAL_MS) {
          if (pending?.owner === owner) {
            await reconcileRemote(owner, pending.entitlement);
          }
          return { entitlementChecked: false };
        }

        // The engine reads IndexedDB. Never let it observe React state that is
        // still waiting in the serialized persistence queue.
        await persistQueue.current;
        if (switchingVault.current || syncOwnerOf(dbRef.current) !== owner) {
          return { entitlementChecked: false };
        }

        const outcome = await syncNow(owner);
        lastSyncAt.current.set(owner, Date.now());
        const entitlementChecked = outcome.entitlement !== undefined;
        if (entitlementChecked) markEntitlementChecked();

        const pendingForOwner = pendingReconcile.current?.owner === owner;
        if (outcome.remoteChanged || pendingForOwner) {
          const accepted = await reconcileRemote(
            owner,
            outcome.entitlement ?? pendingReconcile.current?.entitlement,
          );
          if (!accepted && outcome.entitlement) {
            await applyEntitlementToLiveState(owner, outcome.entitlement);
          }
        } else if (outcome.entitlement) {
          await applyEntitlementToLiveState(owner, outcome.entitlement);
        }
        return { entitlementChecked };
      })().finally(() => {
        if (activeSync.current?.promise === promise) activeSync.current = null;
      });
      const entry = { owner, promise };
      activeSync.current = entry;
      return promise;
    },
    [applyEntitlementToLiveState, reconcileRemote],
  );

  const requestSync = useCallback(
    (owner: string, delayMs = 0, force = true) => {
      const start = () => {
        void syncAccount(owner, force).catch((err) => {
          // A rejected stateless token is cleared by the API client. Reflect
          // that locally; offline/timeout leaves dirty rows and the cursor intact.
          if (err instanceof ApiError && err.status === 401 && err.code !== "session_changed") {
            setDb((prev) => (prev ? { ...prev, auth: null } : prev));
            setSessionGate("ready");
          }
        });
      };

      if (syncDebounce.current) clearTimeout(syncDebounce.current);
      syncDebounce.current = null;
      if (delayMs <= 0) start();
      else syncDebounce.current = setTimeout(start, delayMs);
    },
    [syncAccount],
  );

  const switchAccount = useCallback(
    async (user: { id: string; phone: string }, entitlement: ServerEntitlement) => {
      switchingVault.current = true;
      if (syncDebounce.current) clearTimeout(syncDebounce.current);
      syncDebounce.current = null;
      const current = dbRef.current;
      try {
        if (current) {
          await persistQueue.current;
          const pending = diffDb(lastPersisted.current, current);
          if (localChanged(lastPersisted.current, current)) saveLocal(toLocalState(current));
          if (pending.length) await applyChanges(pending);
        }

        // A login API may already have installed the new token. Let any old
        // owner-bound run stop before changing the active Dexie database; its
        // next HTTP request cannot pass the expected-user check with that token.
        await activeSync.current?.promise.catch(() => undefined);
        pendingReconcile.current = null;
        const currentOwner = current?.meta.dataOwner ?? current?.auth?.phone ?? null;
        await switchOwnerVault(user.id, {
          claimCurrent: currentOwner === null || currentOwner === user.phone,
        });
        const { db: loaded } = await hydrate();
        const localOwner = loaded.meta.dataOwner ?? loaded.auth?.phone ?? null;
        const entitlementCandidate =
          localOwner === null || localOwner === user.phone
            ? loaded
            : { ...loaded, subscription: null };
        const resolved = await resolveServerEntitlement(
          entitlementCandidate,
          entitlement,
          (subscription) => importSubscription(subscription, user.id),
        );
        const next = loginAs(resolved, user.phone, resolved.subscription, Date.now(), user.id);
        saveLocal(toLocalState(next));
        mutationRevision.current += 1;
        lastPersisted.current = next;
        dbRef.current = next;
        setDb(next);
        setSessionGate("ready");
      } finally {
        switchingVault.current = false;
      }
      requestSync(user.id, 0, true);
    },
    [requestSync],
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
          settings: local.settings,
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
      const owner = syncOwnerOf(db);
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
      void write.then(
        () => {
          if (owner && syncOwnerOf(dbRef.current) === owner) {
            requestSync(owner, SYNC_DEBOUNCE_MS, true);
          }
        },
        () => undefined,
      );
    }
  }, [db, requestSync]);

  const syncLifecycle = useCallback(
    async (owner: string) => {
      const current = dbRef.current;
      if (!current?.auth || syncOwnerOf(current) !== owner) return;
      const tokens = loadTokens();
      if (!tokens) {
        setDb((prev) => (prev ? { ...prev, auth: null } : prev));
        setSessionGate("ready");
        return;
      }

      // Do not hold the local UI behind a slow or half-connected network. A valid
      // lease opens immediately; server verification continues in the background.
      // Only an already-expired lease needs a successful online answer first.
      const localDecision = decideSession({
        now: Date.now(),
        lastServerConfirmedAt: tokens.lastServerConfirmedAt,
        online: navigator.onLine,
      });
      setSessionGate(
        localDecision.kind === "needs-online-confirmation"
          ? navigator.onLine
            ? "checking"
            : "needs-online"
          : "ready",
      );

      try {
        if (!navigator.onLine) return;
        const syncResult = await syncAccount(owner, true);
        setSessionGate("ready");
        const latest = loadTokens() ?? tokens;
        if (
          !syncResult?.entitlementChecked &&
          shouldRefreshEntitlement({
            now: Date.now(),
            lastCheckedAt: latest.lastEntitlementCheckedAt,
            expiresAt: current.subscription?.expiresAt,
            force: localDecision.kind === "needs-online-confirmation",
          })
        ) {
          void fetchEntitlement()
            .then(({ entitlement }) => {
              const owner = syncOwnerOf(dbRef.current);
              if (owner) void applyEntitlementToLiveState(owner, entitlement);
            })
            .catch(() => undefined);
        }
      } catch {
        const latest = loadTokens();
        if (!latest) {
          setDb((prev) => (prev ? { ...prev, auth: null } : prev));
          setSessionGate("ready");
          return;
        }
        const decision = decideSession({
          now: Date.now(),
          lastServerConfirmedAt: latest.lastServerConfirmedAt,
          online: navigator.onLine,
        });
        setSessionGate(decision.kind === "needs-online-confirmation" ? "needs-online" : "ready");
      }
    },
    [applyEntitlementToLiveState, syncAccount],
  );

  // Boot, online and foreground events all use the normal account sync. A
  // closed web app cannot execute code; the next open performs the boot sync.
  const sessionOwner = syncOwnerOf(db);
  useEffect(() => {
    if (!sessionOwner) {
      setSessionGate("ready");
      return;
    }
    void syncLifecycle(sessionOwner);
    const onOnline = () => void syncLifecycle(sessionOwner);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncLifecycle(sessionOwner);
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionOwner, syncLifecycle]);

  const retrySession = useCallback(async () => {
    const owner = syncOwnerOf(dbRef.current);
    if (owner) await syncLifecycle(owner);
    else setSessionGate("ready");
  }, [syncLifecycle]);

  useEffect(
    () => () => {
      if (syncDebounce.current) clearTimeout(syncDebounce.current);
    },
    [],
  );

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
      if (
        !isNativeRuntime() &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
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
                firedReminders: [
                  ...prev.meta.firedReminders,
                  ...events.map((event) => event.key),
                ].slice(-300),
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

  const reconcileCurrentNativeReminders = useCallback(() => {
    const current = dbRef.current;
    if (!current) return;
    void reconcileNativeReminders(current, {
      productRemindersAllowed:
        current.settings.notificationsEnabled &&
        productWriteAllowed(current, sessionGateRef.current),
      lifecycleRemindersAllowed: current.settings.notificationsEnabled,
    }).catch(() => {
      // Permission denial, an unavailable plugin, or an OS scheduling failure
      // must never interrupt local persistence or the app UI.
    });
  }, []);

  // Reconciliation derives the complete Routino-owned pending set from current
  // state, so edits, deletes, completion, sync pulls and calendar changes all
  // follow the same path. It checks permission but never requests it.
  useEffect(() => {
    if (!dbRef.current) return;
    reconcileCurrentNativeReminders();
  }, [
    db?.settings.notificationsEnabled,
    db?.settings.journalReminder,
    db?.settings.calendar,
    db?.settings.lang,
    db?.habits,
    db?.tasks,
    db?.subscription?.expiresAt,
    db?.subscription?.trial,
    reconcileCurrentNativeReminders,
  ]);

  // Replenish rolling one-shot reminders and re-read permission/exact-alarm
  // state after resume, focus, timezone changes made while away, or OS restart.
  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState === "visible") reconcileCurrentNativeReminders();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    return () => {
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [reconcileCurrentNativeReminders]);

  // reminder scheduler (habits, tasks, journal) — checks every 30s.
  // Kept as-is: this still drives in-app/foreground browser notifications on
  // web, and continues to populate the in-app notification center/history on
  // native too. The native OS-level alarms above are what fire when the
  // native app is backgrounded or closed.
  useEffect(() => {
    const check = () => {
      const cur = dbRef.current;
      if (!cur || !cur.settings.notificationsEnabled || !cur.auth) return;
      if (!productWriteAllowed(cur, sessionGateRef.current)) return;
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
      if (
        !isNativeRuntime() &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
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
    () => ({
      db,
      update,
      requestProductWrite,
      updatePreferences,
      applyEntitlement,
      commitTrialActivation,
      markNotificationsRead,
      submitFeedback,
      recordFeedbackPrompt,
      signOutLocal,
      signInLocal,
      resetSyncedContent,
      writeBlocked,
      clearWriteBlocked,
      switchAccount,
      sessionGate,
      retrySession,
      lang,
      cal,
      t,
    }),
    [
      db,
      update,
      requestProductWrite,
      updatePreferences,
      applyEntitlement,
      commitTrialActivation,
      markNotificationsRead,
      submitFeedback,
      recordFeedbackPrompt,
      signOutLocal,
      signInLocal,
      resetSyncedContent,
      writeBlocked,
      clearWriteBlocked,
      switchAccount,
      sessionGate,
      retrySession,
      lang,
      cal,
      t,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
