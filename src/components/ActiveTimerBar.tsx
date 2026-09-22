import { Pause, Play, Timer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { faNum, type Lang } from "@/lib/dates";
import {
  consumeAndroidTimerCommand,
  isAndroidNativeTimer,
  reconcileAndroidTimerSnapshot,
  syncAndroidTimer,
} from "@/lib/android-timer-notification";
import { showLocalWebNotification } from "@/lib/local-web-notifications";
import {
  advanceTimer,
  createTimer,
  loadTimer,
  pauseTimer,
  resumeTimer,
  saveTimer,
  TIMER_UPDATED_EVENT,
  type TimerState,
  type TimerUpdatedDetail,
} from "@/lib/timer-runtime";

interface ActiveTimerBarProps {
  owner: string;
  lang: Lang;
  t: (fa: string, en: string) => string;
  onOpen: () => void;
  requestResume?: () => boolean;
}

function belongsToActiveSession(timer: TimerState): boolean {
  return (
    timer.running ||
    timer.onBreak ||
    timer.sessionStartedAt !== null ||
    timer.focusMs > 0 ||
    timer.elapsedMs > 0
  );
}

export function ActiveTimerBar({ owner, lang, t, onOpen, requestResume }: ActiveTimerBarProps) {
  const [timer, setTimer] = useState(() => loadTimer(owner));
  const timerRef = useRef(timer);

  const publish = useCallback(
    (next: TimerState, persist = false) => {
      timerRef.current = next;
      setTimer(next);
      if (persist) saveTimer(owner, next);
    },
    [owner],
  );

  useEffect(() => {
    publish(loadTimer(owner));
    let consumingNativeCommand = false;
    const consumeNativeCommand = async () => {
      if (!isAndroidNativeTimer() || consumingNativeCommand) return;
      consumingNativeCommand = true;
      try {
        const command = await consumeAndroidTimerCommand();
        if (!command) return;
        const current = reconcileAndroidTimerSnapshot(timerRef.current, command.timer);
        if (command.action === "pause" || command.action === "resume") {
          publish(current, true);
          return;
        }
        const pending = [...current.pending];
        if (command.action === "finish" && !current.onBreak && current.focusMs >= 1_000) {
          const endedAt = command.actedAt ?? Date.now();
          pending.push({
            id: `${current.runId}:partial:${current.round}`,
            mode: current.mode,
            focusSeconds: Math.round(current.focusMs / 1_000),
            startedAt: current.sessionStartedAt ?? endedAt - current.focusMs,
            endedAt,
            linked: current.linked,
          });
        }
        publish(
          {
            ...createTimer(
              current.mode,
              current.mode === "pomodoro" ? current.focusMinutes : current.freeMinutes,
              {
                breakMinutes: current.breakMinutes,
                cycles: current.cycles,
                freeMinutes: current.freeMinutes,
                linked: current.linked,
              },
            ),
            pending,
            finished: command.action === "finish",
          },
          true,
        );
      } catch {
        // Native state remains persisted and will be retried on the next foreground tick.
      } finally {
        consumingNativeCommand = false;
      }
    };
    const settle = () => {
      void consumeNativeCommand();
      const before = timerRef.current;
      const result = advanceTimer(before, Date.now());
      if (result.state === before) return;
      publish(result.state, result.transitions.length > 0);
      if (!isAndroidNativeTimer() && result.transitions.length > 0) {
        const transition = result.transitions.at(-1)!;
        const body =
          transition === "finished"
            ? result.state.mode === "pomodoro"
              ? "🎉 همه‌ی دورها تموم شد! آفرین."
              : "⏰ تایمر تمام شد!"
            : transition === "focus-ended"
              ? "⏰ زمان تمرکز تموم شد! وقت استراحته."
              : "☕️ استراحت تموم شد! برگرد سر تمرکز.";
        const id =
          transition === "finished"
            ? `${owner}|timer|${before.runId}|finished`
            : `${owner}|timer|${before.runId}|${result.state.round}|${transition}`;
        void showLocalWebNotification({ id, title: "Routino", body });
      }
    };
    const onTimerUpdated = (event: Event) => {
      const detail = (event as CustomEvent<TimerUpdatedDetail>).detail;
      if (detail?.owner === owner) publish(detail.state);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === `routino:active-timer:v1:${owner}`) publish(loadTimer(owner));
    };
    const onForeground = () => {
      if (document.visibilityState === "visible") void consumeNativeCommand();
    };
    window.addEventListener(TIMER_UPDATED_EVENT, onTimerUpdated);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    const interval = window.setInterval(settle, 1000);
    settle();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(TIMER_UPDATED_EVENT, onTimerUpdated);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
    };
  }, [owner, publish]);

  if (!belongsToActiveSession(timer)) return null;

  const displayMs = timer.mode === "stopwatch" ? timer.elapsedMs : timer.remainingMs;
  const seconds =
    timer.mode === "stopwatch" ? Math.floor(displayMs / 1000) : Math.ceil(displayMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const label = timer.onBreak
    ? t("زمان استراحت", "Break time")
    : timer.mode === "stopwatch"
      ? t("کرونومتر", "Stopwatch")
      : t("تایمر در حال اجرا", "Timer running");

  const toggle = () => {
    if (!timerRef.current.running && requestResume && !requestResume()) return;
    const next = timerRef.current.running
      ? pauseTimer(timerRef.current, Date.now())
      : resumeTimer(timerRef.current, Date.now());
    publish(next, true);
    void syncAndroidTimer(next).catch(() => {
      if (next.running)
        toast.warning(
          t("اعلان تایمر بالای گوشی فعال نشد.", "The timer notification could not start."),
        );
    });
  };

  return (
    <section
      className="sticky z-20 mx-4 mt-3 flex items-center gap-2 rounded-2xl border border-primary/25 bg-card/95 p-2 shadow-sm backdrop-blur-md"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 3.25rem)" }}
      aria-label={t("تایمر فعال", "Active timer")}
    >
      <button
        type="button"
        aria-label={t("باز کردن تایمر", "Open timer")}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-start transition-colors hover:bg-secondary"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Timer className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold text-foreground">{label}</span>
          <span className="block text-[10px] text-muted-foreground">
            {t("برای جزئیات لمس کن", "Tap for details")}
          </span>
        </span>
        <span className="text-lg font-black tabular-nums text-primary" dir="ltr">
          {faNum(mm, lang)}:{faNum(ss, lang)}
        </span>
      </button>
      <button
        type="button"
        aria-label={timer.running ? t("مکث", "Pause") : t("ادامه", "Resume")}
        onClick={toggle}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform active:scale-95"
      >
        {timer.running ? (
          <Pause className="h-4.5 w-4.5" aria-hidden="true" />
        ) : (
          <Play className="h-4.5 w-4.5" aria-hidden="true" />
        )}
      </button>
    </section>
  );
}
