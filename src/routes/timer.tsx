import { createFileRoute } from "@tanstack/react-router";
import { Coffee, Pause, Play, RotateCcw, Square, Timer as TimerIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { CelebrationModal, useCelebration } from "@/components/habits";
import { Button, Card, Chip, DurationPicker, formatDuration } from "@/components/ui";
import {
  shouldTriggerCompletionFeedback,
  triggerCompletionFeedback,
} from "@/lib/completion-feedback";
import { dateKey, faNum, todayKey } from "@/lib/dates";
import {
  consumeAndroidTimerCommand,
  isAndroidNativeTimer,
  openAndroidNotificationSettings,
  reconcileAndroidTimerSnapshot,
  syncAndroidTimer,
} from "@/lib/android-timer-notification";
import { dueHabitsOn, getLog, isCompleted } from "@/lib/logic";
import { showLocalWebNotification } from "@/lib/local-web-notifications";
import {
  checkNativeNotificationPermission,
  requestNativePermission,
  type NativePermissionState,
} from "@/lib/native-notifications";
import { recordTimerCompletion } from "@/lib/timer-credit";
import {
  advanceTimer,
  createTimer,
  loadTimer,
  pauseTimer,
  resumeTimer,
  saveTimer,
  type TimerCompletion,
  type TimerLink,
  type TimerState,
} from "@/lib/timer-runtime";
import type { TimerMode } from "@/lib/store";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/timer")({
  component: () => (
    <AppShell>
      <TimerPage />
    </AppShell>
  ),
});

const POMODORO_PRESETS = [
  { focus: 25, brk: 5 },
  { focus: 50, brk: 10 },
  { focus: 15, brk: 3 },
];
const FREE_PRESETS = [5, 10, 15, 20, 25, 30, 45, 60];
/** چند دور از همان تنظیمِ انتخاب‌شده پشت سر هم اجرا شود. */
const CYCLE_CHOICES = [1, 2, 3, 4, 6, 8, 10];

export function TimerPage() {
  const ctx = useAppMaybe();
  const owner = ctx?.db?.auth?.userId ?? ctx?.db?.auth?.phone ?? null;
  const [timer, setTimer] = useState<TimerState>(createTimer);
  const [timerNotificationPermission, setTimerNotificationPermission] = useState<
    NativePermissionState | "checking"
  >("checking");
  const timerRef = useRef(timer);
  const ownerRef = useRef<string | null>(null);
  const { mode, running, finished, linked, onBreak } = timer;
  const pomoFocusMin = timer.focusMinutes;
  const pomoBreakMin = timer.breakMinutes;
  const pomoCycles = timer.cycles;
  const pomoRound = timer.round;
  const freeMinutes = timer.freeMinutes;
  const remaining = Math.max(0, Math.ceil(timer.remainingMs / 1000));
  const stopwatchElapsed = Math.floor(timer.elapsedMs / 1000);
  const { celebration, clear: clearCelebration } = useCelebration(ctx?.db);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  /** History and linked credit are one idempotent app update. */
  const applyCompletion = (item: TimerCompletion, feedbackEligible = false): boolean => {
    const c = ctxRef.current;
    if (!c?.db) return false;
    const link = item.linked;
    const minutes = item.focusSeconds / 60;
    const dk = dateKey(new Date(item.endedAt));
    const task = link?.kind === "task" ? c.db.tasks.find((x) => x.id === link.id) : null;
    const habit = link?.kind === "habit" ? c.db.habits.find((x) => x.id === link.id) : null;
    const beforeCompleted =
      task?.done ?? (habit ? isCompleted(habit, getLog(c.db, habit.id, dk)) : false);
    const nextValue = task
      ? task.value + (task.unitKind === "time" ? minutes : Math.round(minutes))
      : habit
        ? (getLog(c.db, habit.id, dk)?.value ?? 0) +
          (habit.unitKind === "time" ? minutes : Math.round(minutes))
        : 0;
    const target = task?.target ?? habit?.target;
    const afterCompleted = Boolean(
      beforeCompleted || (target !== undefined && nextValue >= target),
    );
    const accepted = c.update((d) => recordTimerCompletion(d, item, c.cal));
    if (
      feedbackEligible &&
      shouldTriggerCompletionFeedback({
        source: "user",
        mutationAccepted: accepted,
        beforeCompleted,
        afterCompleted,
      })
    )
      triggerCompletionFeedback(c.db.settings);
    return accepted;
  };

  const publish = (next: TimerState, persist = true) => {
    timerRef.current = next;
    setTimer(next);
    if (persist && ownerRef.current) {
      saveTimer(ownerRef.current, next);
      // While backgrounded, the foreground service owns phase changes. Android
      // may reject attempts to start/update a foreground service from the background.
      if (document.visibilityState === "visible") {
        void syncAndroidTimer(next).catch(() => {
          if (next.running) toast.warning("تایمر اجرا می‌شود، اما اعلان بالای گوشی فعال نشد.");
        });
      }
    }
  };

  const flushPending = () => {
    const current = timerRef.current;
    if (!current.pending.length) return;
    const kept = current.pending.filter((item) => !applyCompletion(item));
    if (kept.length !== current.pending.length) publish({ ...current, pending: kept });
  };

  const settle = (now = Date.now(), announce = true) => {
    const before = timerRef.current;
    const { state, transitions } = advanceTimer(before, now);
    if (state !== before) {
      const clockMovedBack =
        state.anchorAt !== null && before.anchorAt !== null && state.anchorAt < before.anchorAt;
      publish(state, transitions.length > 0 || clockMovedBack);
    }
    flushPending();
    if (announce && !isAndroidNativeTimer() && transitions.length > 0) {
      const transition = transitions.at(-1)!;
      const body =
        transition === "finished"
          ? state.mode === "pomodoro"
            ? "🎉 همه‌ی دورها تموم شد! آفرین."
            : "⏰ تایمر تمام شد!"
          : transition === "focus-ended"
            ? "⏰ زمان تمرکز تموم شد! وقت استراحته."
            : "☕️ استراحت تموم شد! برگرد سر تمرکز.";
      const id =
        transition === "finished"
          ? `${owner}|timer|${before.runId}|finished`
          : `${owner}|timer|${before.runId}|${state.round}|${transition}`;
      void showLocalWebNotification({ id, title: "Routino", body });
    }
    return timerRef.current;
  };

  const finalizeSession = (save: boolean, feedbackEligible = false, now = Date.now()) => {
    const current = settle(now, false);
    let next = { ...current, running: false, anchorAt: null };
    if (save && !current.onBreak && current.focusMs >= 1000) {
      const item: TimerCompletion = {
        id: `${current.runId}:partial:${current.round}`,
        mode: current.mode,
        focusSeconds: Math.round(current.focusMs / 1000),
        startedAt: current.sessionStartedAt ?? now - current.focusMs,
        endedAt: now,
        linked: current.linked,
      };
      if (!applyCompletion(item, feedbackEligible))
        next = { ...next, pending: [...next.pending, item] };
    }
    next = { ...next, focusMs: 0, sessionStartedAt: null };
    publish(next);
  };

  useEffect(() => {
    if (!owner) return;
    ownerRef.current = owner;
    publish(loadTimer(owner), false);
    settle(Date.now());
    void syncAndroidTimer(timerRef.current).catch(() => {
      if (timerRef.current.running)
        toast.warning("تایمر اجرا می‌شود، اما اعلان بالای گوشی فعال نشد.");
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") settle(Date.now());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === `routino:active-timer:v1:${owner}`) {
        publish(loadTimer(owner), false);
        settle(Date.now(), false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("storage", onStorage);
    const interval = window.setInterval(() => settle(), 1000);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("storage", onStorage);
      saveTimer(owner, timerRef.current);
      ownerRef.current = null;
    };
    // Timer callbacks read the latest context through refs; only account changes rebind storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  if (!ctx?.db) return null;
  const { db, t, lang, cal } = ctx;

  const dk = todayKey();
  const dueHabits = dueHabitsOn(db, dk, cal)
    .filter((h) => h.type === "quantity" && h.unitKind === "time")
    .filter((h) => !isCompleted(h, getLog(db, h.id, dk)));
  const openTasks = db.tasks.filter(
    (task) =>
      task.dateKey === dk && !task.done && task.type === "quantity" && task.unitKind === "time",
  );

  /** Remaining minutes toward this linked item's time goal (target - already logged). */
  const remainingMinutesFor = (link: TimerLink): number | null => {
    if (!link) return null;
    if (link.kind === "task") {
      const task = db.tasks.find((x) => x.id === link.id);
      if (!task) return null;
      return Math.max(1, Math.round(task.target - task.value));
    }
    const habit = db.habits.find((h) => h.id === link.id);
    if (!habit) return null;
    const log = getLog(db, habit.id, dk);
    return Math.max(1, Math.round(habit.target - (log?.value ?? 0)));
  };

  /** Pick a linked habit/task. Works with the current mode (Pomodoro or Free) —
   * only real focus time is credited to the item. In Free mode it also preloads
   * the item's remaining duration for convenience. */
  const selectLink = (link: TimerLink) => {
    if (!link) {
      publish({ ...settle(), linked: null });
      return;
    }
    finalizeSession(false);
    const current = timerRef.current;
    const minutes = mode === "free" ? (remainingMinutesFor(link) ?? 25) : current.freeMinutes;
    publish({
      ...current,
      runId: createTimer().runId,
      linked: link,
      freeMinutes: minutes,
      remainingMs: (mode === "free" ? minutes : current.focusMinutes) * 60_000,
      onBreak: false,
      round: 1,
      finished: false,
    });
  };

  const displaySeconds = mode === "stopwatch" ? stopwatchElapsed : remaining;
  const mm = String(Math.floor(displaySeconds / 60)).padStart(2, "0");
  const ss = String(displaySeconds % 60).padStart(2, "0");

  const totalForRing =
    mode === "pomodoro" ? (onBreak ? pomoBreakMin : pomoFocusMin) * 60 : freeMinutes * 60;
  const progress = mode === "stopwatch" ? 0 : totalForRing > 0 ? 1 - remaining / totalForRing : 0;

  const switchMode = (m: TimerMode) => {
    finalizeSession(true); // save any in-progress focus time before switching
    const current = timerRef.current;
    publish({
      ...createTimer(m, m === "pomodoro" ? current.focusMinutes : current.freeMinutes, {
        breakMinutes: current.breakMinutes,
        cycles: current.cycles,
        freeMinutes: current.freeMinutes,
        linked: m === "free" ? current.linked : null,
      }),
      pending: current.pending,
    });
  };

  const reset = () => {
    finalizeSession(false); // discard current progress on manual reset
    const current = timerRef.current;
    publish({
      ...createTimer(mode, mode === "pomodoro" ? current.focusMinutes : current.freeMinutes, {
        breakMinutes: current.breakMinutes,
        cycles: current.cycles,
        linked: current.linked,
      }),
      pending: current.pending,
    });
  };

  const stopAndSave = () => {
    finalizeSession(true, true);
    const current = timerRef.current;
    publish({
      ...createTimer(mode, mode === "pomodoro" ? current.focusMinutes : current.freeMinutes, {
        breakMinutes: current.breakMinutes,
        cycles: current.cycles,
        linked: current.linked,
      }),
      pending: current.pending,
      finished: true,
    });
  };

  // The native plugin atomically consumes the command before returning it.
  // Reconcile on both initial mount and foreground because Android can deliver
  // an action while the WebView process is paused or already alive.
  useEffect(() => {
    if (!owner || !isAndroidNativeTimer()) return;
    let cancelled = false;
    const consume = async () => {
      try {
        const command = await consumeAndroidTimerCommand();
        if (cancelled || !command) return;
        const now = command.actedAt ?? Date.now();
        const reconciled = command.timer
          ? reconcileAndroidTimerSnapshot(timerRef.current, command.timer)
          : command.action === "pause"
            ? pauseTimer(settle(now, false), now)
            : command.action === "resume"
              ? resumeTimer(timerRef.current, now)
              : timerRef.current;
        if (command.action === "pause" || command.action === "resume") {
          publish(reconciled);
          return;
        }
        timerRef.current = reconciled;
        setTimer(reconciled);
        if (command.action === "finish") {
          finalizeSession(true, true, now);
          return;
        }
        finalizeSession(false, false, now);
        const current = timerRef.current;
        publish({
          ...createTimer(
            current.mode,
            current.mode === "pomodoro" ? current.focusMinutes : current.freeMinutes,
            {
              breakMinutes: current.breakMinutes,
              cycles: current.cycles,
              linked: current.linked,
            },
          ),
          pending: current.pending,
        });
      } catch {
        // The active timer remains safe in local storage if the native bridge is unavailable.
      }
    };
    const onForeground = () => {
      if (document.visibilityState === "visible") void consume();
    };
    void consume();
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [owner]);

  useEffect(() => {
    if (!isAndroidNativeTimer()) return;
    let cancelled = false;
    const refreshPermission = async () => {
      try {
        const permission = await checkNativeNotificationPermission();
        if (!cancelled) setTimerNotificationPermission(permission);
      } catch {
        if (!cancelled) setTimerNotificationPermission("denied");
      }
    };
    void refreshPermission();
    const onForeground = () => {
      if (document.visibilityState === "visible") void refreshPermission();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, []);

  const activateTimerNotification = async () => {
    try {
      // The displayed state may be stale while Android is returning from a
      // permission dialog. Re-read it on this explicit tap before deciding
      // whether to prompt or send the user to Settings.
      const permissionBeforeAction = await checkNativeNotificationPermission();
      if (permissionBeforeAction === "prompt") await requestNativePermission();
      else if (permissionBeforeAction === "denied") await openAndroidNotificationSettings();
      const permission = await checkNativeNotificationPermission();
      setTimerNotificationPermission(permission);
      if (timerRef.current.running) await syncAndroidTimer(timerRef.current);
    } catch {
      toast.warning("تنظیمات اعلان باز نشد؛ تایمر همچنان در پس‌زمینه ادامه دارد.");
    }
  };

  const toggleRunning = async () => {
    if (!timerRef.current.running && !ctxRef.current?.requestProductWrite()) return;
    const starting = !timerRef.current.running;
    publish(
      timerRef.current.running
        ? pauseTimer(timerRef.current, Date.now())
        : resumeTimer(timerRef.current, Date.now()),
    );
    flushPending();
    // Permission is deliberately not requested on Start: the timer and its
    // background service begin immediately even if the user dismisses it.
    if (starting && isAndroidNativeTimer()) {
      try {
        setTimerNotificationPermission(await checkNativeNotificationPermission());
      } catch {
        setTimerNotificationPermission("denied");
      }
    }
  };

  const applyFreePreset = (m: number) => {
    finalizeSession(false);
    const current = timerRef.current;
    publish({
      ...createTimer("free", m, {
        breakMinutes: current.breakMinutes,
        cycles: current.cycles,
        linked: current.linked,
      }),
      pending: current.pending,
    });
  };

  /**
   * تعداد دورها را عوض می‌کند بدون اینکه تایمرِ در حال اجرا را قطع کند.
   *
   * فقط اگر کاربر تعداد را به عددی کمتر از دورِ فعلی ببرد دور را عقب می‌کشیم،
   * وگرنه «دور ۵ از ۳» نشان داده می‌شود و ست هیچ‌وقت تمام نمی‌شود.
   */
  const setCycles = (n: number) => {
    const current = settle();
    publish({
      ...current,
      cycles: n,
      round: Math.min(current.round, n),
      runId: current.round > n ? createTimer().runId : current.runId,
    });
  };

  const applyPomoPreset = (focus: number, brk: number) => {
    finalizeSession(false);
    const current = timerRef.current;
    publish({
      ...createTimer("pomodoro", focus, {
        breakMinutes: brk,
        cycles: current.cycles,
        linked: current.linked,
      }),
      pending: current.pending,
    });
  };

  return (
    <div className="page-stagger flex flex-col gap-6">
      {/* mode switch */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => switchMode("pomodoro")}
          className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-bold transition-all ${
            mode === "pomodoro"
              ? "border-primary bg-primary-soft text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          <TimerIcon className="h-4 w-4" />
          {t("پومودورو", "Pomodoro")}
        </button>
        <button
          onClick={() => switchMode("free")}
          className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-bold transition-all ${
            mode === "free"
              ? "border-primary bg-primary-soft text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          <TimerIcon className="h-4 w-4" />
          {t("تایمر آزاد", "Free timer")}
        </button>
        <button
          onClick={() => switchMode("stopwatch")}
          className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-bold transition-all ${
            mode === "stopwatch"
              ? "border-primary bg-primary-soft text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          <Square className="h-4 w-4" />
          {t("کرونومتر", "Stopwatch")}
        </button>
      </div>

      <Card className="flex flex-col items-center gap-5 py-8">
        {mode === "pomodoro" && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {onBreak && (
              <div className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-bold text-muted-foreground">
                <Coffee className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                {t("زمان استراحت", "Break time")}
              </div>
            )}
            {pomoCycles > 1 && (
              <div className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary">
                {t(
                  `دور ${faNum(pomoRound, lang)} از ${faNum(pomoCycles, lang)}`,
                  `Round ${pomoRound} of ${pomoCycles}`,
                )}
              </div>
            )}
          </div>
        )}
        <div className="relative flex h-52 w-52 items-center justify-center">
          {mode !== "stopwatch" ? (
            <svg viewBox="0 0 100 100" className="h-52 w-52 -rotate-90">
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="var(--secondary)"
                strokeWidth="6"
              />
              {progress > 0 && (
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke={onBreak ? "var(--muted-foreground)" : "var(--primary)"}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${progress * 282.7} 282.7`}
                  className="transition-all duration-1000"
                />
              )}
            </svg>
          ) : (
            <div
              className={`h-52 w-52 rounded-full border-[6px] ${running ? "border-primary" : "border-secondary"} transition-colors`}
            />
          )}
          <div className="absolute text-center" dir="ltr">
            <p className="text-5xl font-black tabular-nums text-foreground">
              {faNum(mm, lang)}:{faNum(ss, lang)}
            </p>
            {finished && (
              <p className="mt-1 text-xs font-bold text-success">{t("تمام شد! 🎉", "Done! 🎉")}</p>
            )}
          </div>
        </div>

        {/* آیکون‌های تنها: بدون aria-label اسکرین‌ریدر فقط «دکمه» می‌گوید — و
            اینها کنترل‌های اصلی تایمرند، نه چیز فرعی. */}
        <div className="flex gap-3">
          <Button
            onClick={toggleRunning}
            disabled={mode !== "stopwatch" && remaining === 0 && !running}
            aria-label={running ? t("توقف موقت", "Pause") : t("شروع", "Start")}
            className="h-14 w-14 rounded-full p-0"
          >
            {running ? (
              <Pause className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Play className="h-6 w-6" aria-hidden="true" />
            )}
          </Button>
          {mode === "stopwatch" && running && (
            <Button
              variant="secondary"
              onClick={stopAndSave}
              aria-label={t("توقف و ذخیره", "Stop and save")}
              className="h-14 w-14 rounded-full p-0"
            >
              <Square className="h-5 w-5" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={reset}
            aria-label={t("شروع دوباره", "Reset")}
            className="h-14 w-14 rounded-full p-0"
          >
            <RotateCcw className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>

        {isAndroidNativeTimer() && running && timerNotificationPermission !== "granted" && (
          <div className="flex max-w-sm items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
            <span className="flex-1">
              {t(
                "تایمر در پس‌زمینه ادامه دارد؛ برای دیدنش در نوار بالا اعلان را فعال کن.",
                "The timer continues in the background. Enable notifications to show it in the status bar.",
              )}
            </span>
            <Button variant="secondary" className="shrink-0" onClick={activateTimerNotification}>
              {t("فعال‌کردن اعلان", "Enable notifications")}
            </Button>
          </div>
        )}

        {mode === "pomodoro" && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex flex-wrap justify-center gap-1.5">
              {POMODORO_PRESETS.map((p) => (
                <Chip
                  key={`${p.focus}-${p.brk}`}
                  active={pomoFocusMin === p.focus && pomoBreakMin === p.brk}
                  onClick={() => applyPomoPreset(p.focus, p.brk)}
                >
                  {faNum(p.focus, lang)}/{faNum(p.brk, lang)} {t("دقیقه", "min")}
                </Chip>
              ))}
            </div>

            {/* چند دور پشت سر هم. تغییر تعداد وسطِ کار تایمر را از نو شروع
                نمی‌کند؛ فقط می‌گوید این ست کِی تمام شود. */}
            <div className="flex flex-col items-center gap-1.5">
              <p className="text-[10px] font-medium text-muted-foreground">
                {t("چند دور پشت سر هم؟", "How many rounds?")}
              </p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {CYCLE_CHOICES.map((c) => (
                  <Chip key={c} active={pomoCycles === c} onClick={() => setCycles(c)}>
                    {faNum(c, lang)}
                  </Chip>
                ))}
              </div>
            </div>

            <p className="text-center text-[10px] text-muted-foreground">
              {pomoCycles > 1
                ? t(
                    `${faNum(pomoCycles, lang)} دور ${faNum(pomoFocusMin, lang)} دقیقه‌ای، جمعاً ${faNum(pomoCycles * pomoFocusMin, lang)} دقیقه تمرکز. فقط زمان تمرکز حساب می‌شود.`,
                    `${pomoCycles} rounds of ${pomoFocusMin} min, ${pomoCycles * pomoFocusMin} min of focus in total. Only focus time counts.`,
                  )
                : t(
                    "فقط زمان تمرکز حساب می‌شود، استراحت حساب نمی‌شود.",
                    "Only focus time counts; breaks are excluded.",
                  )}
            </p>
          </div>
        )}

        {mode === "free" && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {FREE_PRESETS.map((m) => (
              <Chip key={m} active={freeMinutes === m} onClick={() => applyFreePreset(m)}>
                {faNum(m, lang)} {t("دقیقه", "min")}
              </Chip>
            ))}
          </div>
        )}

        {mode === "free" && (
          <div className="w-full max-w-xs">
            <p className="mb-1.5 text-center text-[10px] text-muted-foreground">
              {t("یا مدت دلخواه رو تنظیم کن", "Or set a custom duration")}
            </p>
            <DurationPicker
              totalMinutes={freeMinutes}
              onChange={(m) => applyFreePreset(Math.max(1, Math.round(m)))}
              lang={lang}
              t={t}
            />
          </div>
        )}
      </Card>

      {/* link to habit/task */}
      <Card>
        <p className="mb-2 text-sm font-bold text-foreground">
          {t("اتصال تایمر به عادت یا کار زمانی", "Link timer to a time-based habit or task")}
        </p>
        <p className="mb-3 text-[10px] text-muted-foreground">
          {t(
            "فقط عادت‌ها و کارهای زمانی قابل اتصال‌ان. با هر حالتی (پومودورو یا آزاد) کار می‌کنه و فقط زمانِ تمرکز به هدف اضافه می‌شه.",
            "Only time-based habits and tasks can be linked. Works in any mode (Pomodoro or Free); only focus time counts toward the goal.",
          )}
        </p>
        {dueHabits.length === 0 && openTasks.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t(
              "هنوز عادت یا کار زمانی برای امروز نداری.",
              "You don't have any time-based habits or tasks for today yet.",
            )}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <Chip active={!linked} onClick={() => selectLink(null)}>
              {t("هیچ‌کدام", "None")}
            </Chip>
            {dueHabits.map((h) => (
              <Chip
                key={h.id}
                active={linked?.kind === "habit" && linked.id === h.id}
                onClick={() => selectLink({ kind: "habit", id: h.id, label: h.name })}
              >
                🔁 {h.name}
              </Chip>
            ))}
            {openTasks.map((task) => (
              <Chip
                key={task.id}
                active={linked?.kind === "task" && linked.id === task.id}
                onClick={() => selectLink({ kind: "task", id: task.id, label: task.title })}
              >
                📋 {task.title}
              </Chip>
            ))}
          </div>
        )}
      </Card>

      {/* recent sessions */}
      {db.timerSessions.length > 0 && (
        <Card>
          <p className="mb-2 text-sm font-bold text-foreground">
            {t("جلسات اخیر", "Recent sessions")}
          </p>
          <div className="flex flex-col gap-2">
            {db.timerSessions.slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {s.mode === "pomodoro" ? "🍅" : s.mode === "free" ? "⏱️" : "⏲️"}{" "}
                  {s.linkedLabel ?? t("بدون اتصال", "Unlinked")}
                </span>
                <span className="font-bold text-foreground">
                  {formatDuration(s.focusSeconds / 60, lang)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <CelebrationModal celebration={celebration} onClose={clearCelebration} t={t} lang={lang} />
    </div>
  );
}
