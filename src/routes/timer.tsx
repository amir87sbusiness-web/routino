import { createFileRoute } from "@tanstack/react-router";
import { Coffee, Pause, Play, RotateCcw, Square, Timer as TimerIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { applyLog, CelebrationModal, useCelebration } from "@/components/habits";
import { Button, Card, Chip, DurationPicker, formatDuration } from "@/components/ui";
import { faNum, todayKey } from "@/lib/dates";
import { dueHabitsOn, getLog, isCompleted } from "@/lib/logic";
import { uid, type TimerMode } from "@/lib/store";
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

type Linked = { kind: "habit" | "task"; id: string; label: string } | null;

function TimerPage() {
  const ctx = useAppMaybe();

  const [mode, setMode] = useState<TimerMode>("pomodoro");

  // Pomodoro state
  const [pomoFocusMin, setPomoFocusMin] = useState(25);
  const [pomoBreakMin, setPomoBreakMin] = useState(5);
  const [onBreak, setOnBreak] = useState(false);

  // Free timer state
  const [freeMinutes, setFreeMinutes] = useState(25);

  // shared running state
  const [remaining, setRemaining] = useState(25 * 60); // seconds, for pomodoro/free
  const [stopwatchElapsed, setStopwatchElapsed] = useState(0); // seconds, for stopwatch
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  // accumulated focus seconds for the CURRENT session (excludes breaks)
  const focusAccumRef = useRef(0);
  const sessionStartRef = useRef<number | null>(null);

  const [linked, setLinked] = useState<Linked>(null);
  const { celebration, clear: clearCelebration } = useCelebration(ctx?.db);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const linkedRef = useRef(linked);
  linkedRef.current = linked;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onBreakRef = useRef(onBreak);
  onBreakRef.current = onBreak;
  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;

  const notify = (body: string) => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Routino", { body });
      } catch {
        /* noop */
      }
    }
  };

  /** Commit accumulated focus minutes (rounded) to the linked habit/task. */
  const commitFocusToLinked = (focusSeconds: number) => {
    const c = ctxRef.current;
    const link = linkedRef.current;
    if (!c?.db || !link || focusSeconds <= 0) return;
    const minutes = focusSeconds / 60;
    const dk = todayKey();
    if (link.kind === "task") {
      c.update((d) => ({
        ...d,
        tasks: d.tasks.map((x) => {
          if (x.id !== link.id) return x;
          if (x.type === "binary") return { ...x, done: true, value: x.target };
          const nextVal =
            x.unitKind === "time" ? Math.round((x.value + minutes) * 100) / 100 : x.value + Math.round(minutes);
          return { ...x, value: nextVal, done: nextVal >= x.target || x.done };
        }),
      }));
    } else {
      if (!c.db.habits.some((h) => h.id === link.id)) return;
      // Derive the patch inside the updater: `d` is the fresh db, whereas the
      // captured `c.db` is a snapshot from before this callback fired.
      c.update((d) => {
        const habit = d.habits.find((h) => h.id === link.id);
        if (!habit) return d;
        const prevVal = getLog(d, habit.id, dk)?.value ?? 0;
        let patch: Partial<{ value: number; done: boolean }>;
        if (habit.type === "binary") {
          patch = { done: true, value: 1 };
        } else {
          const nextVal =
            habit.unitKind === "time" ? Math.round((prevVal + minutes) * 100) / 100 : prevVal + Math.round(minutes);
          patch = { value: nextVal, done: nextVal >= habit.target };
        }
        return applyLog(d, habit, c.cal, patch, dk).db;
      });
    }
  };

  const logSession = (focusSeconds: number, m: TimerMode) => {
    const c = ctxRef.current;
    const link = linkedRef.current;
    if (!c?.db || focusSeconds < 1) return;
    const startedAt = sessionStartRef.current ?? Date.now() - focusSeconds * 1000;
    c.update((d) => ({
      ...d,
      // Sort before trimming rather than relying on the array already being
      // newest-first: the trim decides which sessions are DELETED, and once sync
      // merges two devices' histories it must reach the same 200 on both.
      timerSessions: [
        {
          id: uid(),
          mode: m,
          focusSeconds: Math.round(focusSeconds),
          startedAt,
          endedAt: Date.now(),
          linkedKind: link?.kind,
          linkedId: link?.id,
          linkedLabel: link?.label,
        },
        ...d.timerSessions,
      ]
        .sort((a, b) => b.endedAt - a.endedAt)
        .slice(0, 200),
    }));
  };

  /** Stop everything, optionally saving progress made so far. */
  const finalizeSession = (save: boolean) => {
    setRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    const focusSeconds = focusAccumRef.current;
    if (save && focusSeconds > 0) {
      commitFocusToLinked(focusSeconds);
      logSession(focusSeconds, modeRef.current);
    }
    focusAccumRef.current = 0;
    sessionStartRef.current = null;
  };

  useEffect(() => {
    if (!running) return;
    if (sessionStartRef.current === null) sessionStartRef.current = Date.now();

    // The tick drives off `remainingRef` and assigns a plain value rather than
    // running this logic inside a `setRemaining` updater. Updaters must be pure:
    // React invokes them during render and double-invokes them under StrictMode,
    // which would fire these commits/notifications twice per tick.
    intervalRef.current = setInterval(() => {
      if (modeRef.current === "stopwatch") {
        setStopwatchElapsed((s) => s + 1);
        focusAccumRef.current += 1;
        return;
      }

      // pomodoro / free
      const r = remainingRef.current;
      const setRemainingTo = (next: number) => {
        remainingRef.current = next;
        setRemaining(next);
      };

      if (r > 1) {
        if (modeRef.current === "free" || (modeRef.current === "pomodoro" && !onBreakRef.current)) {
          focusAccumRef.current += 1;
        }
        setRemainingTo(r - 1);
        return;
      }

      if (modeRef.current === "pomodoro") {
        if (!onBreakRef.current) {
          // focus interval just finished -> commit accumulated focus, then start break
          focusAccumRef.current += 1;
          const focusSeconds = focusAccumRef.current;
          commitFocusToLinked(focusSeconds);
          logSession(focusSeconds, "pomodoro");
          focusAccumRef.current = 0;
          sessionStartRef.current = null;
          notify("⏰ زمان تمرکز تموم شد! وقت استراحته.");
          setOnBreak(true);
          onBreakRef.current = true;
          setRemainingTo(pomoBreakMin * 60);
          return;
        }
        // break just finished -> back to focus, don't count as focus time
        notify("☕️ استراحت تموم شد! برگرد سر تمرکز.");
        setOnBreak(false);
        onBreakRef.current = false;
        setRemainingTo(pomoFocusMin * 60);
        return;
      }

      // free timer finished
      focusAccumRef.current += 1;
      const focusSeconds = focusAccumRef.current;
      commitFocusToLinked(focusSeconds);
      logSession(focusSeconds, "free");
      focusAccumRef.current = 0;
      sessionStartRef.current = null;
      setRunning(false);
      setFinished(true);
      notify("⏰ تایمر تمام شد!");
      setRemainingTo(0);
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  if (!ctx?.db) return null;
  const { db, t, lang, cal } = ctx;

  const dk = todayKey();
  const dueHabits = dueHabitsOn(db, dk, cal)
    .filter((h) => h.type === "quantity" && h.unitKind === "time")
    .filter((h) => !isCompleted(h, getLog(db, h.id, dk)));
  const openTasks = db.tasks.filter(
    (task) => task.dateKey === dk && !task.done && task.type === "quantity" && task.unitKind === "time",
  );

  /** Remaining minutes toward this linked item's time goal (target - already logged). */
  const remainingMinutesFor = (link: Linked): number | null => {
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
  const selectLink = (link: Linked) => {
    setLinked(link);
    if (!link) return;
    finalizeSession(false);
    setFinished(false);
    setOnBreak(false);
    if (mode === "free") {
      const minutes = remainingMinutesFor(link) ?? 25;
      setFreeMinutes(minutes);
      setRemaining(minutes * 60);
    }
  };

  const displaySeconds = mode === "stopwatch" ? stopwatchElapsed : remaining;
  const mm = String(Math.floor(displaySeconds / 60)).padStart(2, "0");
  const ss = String(displaySeconds % 60).padStart(2, "0");

  const totalForRing = mode === "pomodoro" ? (onBreak ? pomoBreakMin : pomoFocusMin) * 60 : freeMinutes * 60;
  const progress = mode === "stopwatch" ? 0 : totalForRing > 0 ? 1 - remaining / totalForRing : 0;

  const switchMode = (m: TimerMode) => {
    finalizeSession(true); // save any in-progress focus time before switching
    setMode(m);
    setFinished(false);
    setOnBreak(false);
    if (m !== "free" && linked) setLinked(null); // duration-sync only applies to the Free timer
    if (m === "pomodoro") setRemaining(pomoFocusMin * 60);
    else if (m === "free") setRemaining(freeMinutes * 60);
    else setStopwatchElapsed(0);
  };

  const reset = () => {
    finalizeSession(false); // discard current progress on manual reset
    setFinished(false);
    setOnBreak(false);
    if (mode === "pomodoro") setRemaining(pomoFocusMin * 60);
    else if (mode === "free") setRemaining(freeMinutes * 60);
    else setStopwatchElapsed(0);
  };

  const stopAndSave = () => {
    finalizeSession(true);
    setFinished(true);
    if (mode === "pomodoro") setRemaining(pomoFocusMin * 60);
    else if (mode === "free") setRemaining(freeMinutes * 60);
    setOnBreak(false);
  };

  const toggleRunning = () => {
    if (!running) setFinished(false);
    setRunning((r) => !r);
  };

  const applyFreePreset = (m: number) => {
    finalizeSession(false);
    setFreeMinutes(m);
    setRemaining(m * 60);
    setFinished(false);
  };

  const applyPomoPreset = (focus: number, brk: number) => {
    finalizeSession(false);
    setPomoFocusMin(focus);
    setPomoBreakMin(brk);
    setOnBreak(false);
    setRemaining(focus * 60);
    setFinished(false);
  };

  return (
    <div className="page-stagger flex flex-col gap-6">
      {/* mode switch */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => switchMode("pomodoro")}
          className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-bold transition-all ${
            mode === "pomodoro" ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
          }`}
        >
          <TimerIcon className="h-4 w-4" />
          {t("پومودورو", "Pomodoro")}
        </button>
        <button
          onClick={() => switchMode("free")}
          className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-bold transition-all ${
            mode === "free" ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
          }`}
        >
          <TimerIcon className="h-4 w-4" />
          {t("تایمر آزاد", "Free timer")}
        </button>
        <button
          onClick={() => switchMode("stopwatch")}
          className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-bold transition-all ${
            mode === "stopwatch" ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
          }`}
        >
          <Square className="h-4 w-4" />
          {t("کرونومتر", "Stopwatch")}
        </button>
      </div>

      <Card className="flex flex-col items-center gap-5 py-8">
        {mode === "pomodoro" && onBreak && (
          <div className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-bold text-muted-foreground">
            <Coffee className="h-3.5 w-3.5" /> {t("زمان استراحت", "Break time")}
          </div>
        )}
        <div className="relative flex h-52 w-52 items-center justify-center">
          {mode !== "stopwatch" ? (
            <svg viewBox="0 0 100 100" className="h-52 w-52 -rotate-90">
              <circle cx="50" cy="50" r="45" fill="none" stroke="var(--secondary)" strokeWidth="6" />
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
            <div className={`h-52 w-52 rounded-full border-[6px] ${running ? "border-primary" : "border-secondary"} transition-colors`} />
          )}
          <div className="absolute text-center" dir="ltr">
            <p className="text-5xl font-black tabular-nums text-foreground">
              {faNum(mm, lang)}:{faNum(ss, lang)}
            </p>
            {finished && <p className="mt-1 text-xs font-bold text-success">{t("تمام شد! 🎉", "Done! 🎉")}</p>}
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
            {running ? <Pause className="h-6 w-6" aria-hidden="true" /> : <Play className="h-6 w-6" aria-hidden="true" />}
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
            <p className="text-[10px] text-muted-foreground">
              {t("فقط زمان تمرکز حساب می‌شود، استراحت حساب نمی‌شود.", "Only focus time counts; breaks are excluded.")}
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
          <p className="mb-2 text-sm font-bold text-foreground">{t("جلسات اخیر", "Recent sessions")}</p>
          <div className="flex flex-col gap-2">
            {db.timerSessions.slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {s.mode === "pomodoro" ? "🍅" : s.mode === "free" ? "⏱️" : "⏲️"}{" "}
                  {s.linkedLabel ?? t("بدون اتصال", "Unlinked")}
                </span>
                <span className="font-bold text-foreground">{formatDuration(s.focusSeconds / 60, lang)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <CelebrationModal celebration={celebration} onClose={clearCelebration} t={t} lang={lang} />
    </div>
  );
}
