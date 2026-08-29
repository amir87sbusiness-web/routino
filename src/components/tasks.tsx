/** Shared task row + quick "Today's To-dos" card, used on both Home and Tasks pages. */
import { Bell, Check, ChevronDown, Minus, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { AnimatedCompletionList } from "@/components/AnimatedCompletionList";
import { useHorizontalDrag } from "@/components/useHorizontalDrag";
import { CatIcon, formatDuration, Progress } from "@/components/ui";
import { faNum, type Lang } from "@/lib/dates";
import {
  shouldTriggerCompletionFeedback,
  triggerCompletionFeedback,
} from "@/lib/completion-feedback";
import { uid, type Db, type Settings, type Task } from "@/lib/store";

/** A single task row with swipe-to-complete/undo gesture and a check-pop
 * animation, matching HabitRow's interaction pattern. */
export function TaskRow({
  task,
  settings,
  lang,
  t,
  onUpdate,
  onDelete,
  onCompletionChange,
}: {
  task: Task;
  settings: Pick<Settings, "completionSoundEnabled" | "hapticsEnabled">;
  lang: Lang;
  t: (fa: string, en: string) => string;
  onUpdate: (patch: Partial<Task>) => boolean;
  onDelete: () => void;
  onCompletionChange?: (completed: boolean) => void;
}) {
  const [justCompleted, setJustCompleted] = useState(false);
  const [rowFlash, setRowFlash] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const doneHintRef = useRef<HTMLSpanElement>(null);
  const undoHintRef = useRef<HTMLSpanElement>(null);
  const suppressClickUntil = useRef(0);
  const tint = task.color ?? "var(--primary)";
  const SWIPE_THRESHOLD = 76;

  const commit = (patch: Partial<Task>) => {
    const afterCompleted =
      patch.done ??
      (task.type === "quantity" ? (patch.value ?? task.value) >= task.target : task.done);
    const mutationAccepted = onUpdate(patch);
    if (mutationAccepted && task.done !== afterCompleted) onCompletionChange?.(afterCompleted);
    if (
      shouldTriggerCompletionFeedback({
        source: "user",
        mutationAccepted,
        beforeCompleted: task.done,
        afterCompleted,
      })
    ) {
      triggerCompletionFeedback(settings);
    }
    return mutationAccepted;
  };

  const toggleDone = (next: boolean) => {
    const accepted = commit({ done: next, value: next ? task.target : task.value });
    if (!accepted) return;
    setRowFlash(true);
    setTimeout(() => setRowFlash(false), 300);
    if (next) {
      setJustCompleted(true);
      setTimeout(() => setJustCompleted(false), 350);
    }
  };

  const resetSwipe = () => {
    const content = contentRef.current;
    if (content) {
      content.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
      content.style.transform = "translate3d(0, 0, 0)";
    }
    if (doneHintRef.current) doneHintRef.current.style.opacity = "0";
    if (undoHintRef.current) undoHintRef.current.style.opacity = "0";
  };

  const dragBindings = useHorizontalDrag({
    maxDistance: 120,
    onStart: () => {
      const content = contentRef.current;
      if (!content) return;
      content.style.transition = "none";
      content.style.willChange = "transform";
    },
    onMove: ({ dx }) => {
      if (contentRef.current) contentRef.current.style.transform = `translate3d(${dx}px, 0, 0)`;
      if (doneHintRef.current) {
        doneHintRef.current.style.opacity = String(dx > 20 ? Math.min(1, dx / SWIPE_THRESHOLD) : 0);
      }
      if (undoHintRef.current) {
        undoHintRef.current.style.opacity = String(
          -dx > 20 ? Math.min(1, -dx / SWIPE_THRESHOLD) : 0,
        );
      }
    },
    onEnd: ({ dx, cancelled }) => {
      suppressClickUntil.current = Date.now() + 300;
      resetSwipe();
      if (cancelled) return;
      if (dx > SWIPE_THRESHOLD && !task.done) toggleDone(true);
      else if (-dx > SWIPE_THRESHOLD && task.done) toggleDone(false);
    },
  });

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* swipe background hints */}
      <div className="absolute inset-0 flex items-center justify-between px-5">
        <span
          ref={doneHintRef}
          className="flex items-center gap-1 text-xs font-bold text-success opacity-0"
        >
          <Check className="h-4 w-4" strokeWidth={3} /> {t("انجام شد", "Done")}
        </span>
        <span
          ref={undoHintRef}
          className="flex items-center gap-1 text-xs font-bold text-destructive opacity-0"
        >
          {t("لغو", "Undo")} <X className="h-4 w-4" strokeWidth={3} />
        </span>
      </div>

      <div
        ref={contentRef}
        {...dragBindings}
        onClickCapture={(event) => {
          if (Date.now() >= suppressClickUntil.current) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onTransitionEnd={(event) => {
          if (event.propertyName === "transform") event.currentTarget.style.willChange = "auto";
        }}
        className={`swipe-row card-surface relative touch-pan-y p-3.5 ${rowFlash ? "animate-row-flash" : ""}`}
        style={{
          backgroundColor: task.done ? `${tint}22` : undefined,
          borderColor: task.done ? `${tint}55` : undefined,
          transform: "translate3d(0, 0, 0)",
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => toggleDone(!task.done)}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-90 ${
              task.done
                ? "border-transparent text-white"
                : "border-border text-transparent hover:border-primary"
            }`}
            style={task.done ? { backgroundColor: tint } : undefined}
          >
            <Check
              className={`h-5 w-5 ${justCompleted ? "animate-check-pop" : ""}`}
              strokeWidth={3}
            />
          </button>

          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: tint }}
          >
            <CatIcon icon={task.icon ?? "star"} className="h-3.5 w-3.5" />
          </span>

          <div className="min-w-0 flex-1">
            <p
              className={`text-sm font-medium ${task.done ? "text-muted-foreground line-through" : "text-foreground"}`}
            >
              {task.title}
            </p>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {task.note && <span className="truncate">📝 {task.note}</span>}
              {task.reminderAt && (
                <span className="flex items-center gap-0.5">
                  <Bell className="h-2.5 w-2.5" />
                  {new Date(task.reminderAt).toLocaleString(lang === "fa" ? "fa-IR" : "en-US", {
                    dateStyle: "short",
                    timeStyle: "short",
                    hour12: false,
                  })}
                </span>
              )}
            </div>
          </div>

          {task.type === "quantity" && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const v = Math.max(0, task.value - 1);
                  commit({ value: v, done: v >= task.target });
                }}
                className="rounded-full border border-border p-1.5 text-muted-foreground"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="min-w-10 text-center text-xs font-bold text-foreground">
                {task.unitKind === "time"
                  ? `${formatDuration(task.value, lang)}/${formatDuration(task.target, lang)}`
                  : `${faNum(task.value, lang)}/${faNum(task.target, lang)}`}
              </span>
              <button
                onClick={() => {
                  const v = task.value + 1;
                  commit({ value: v, done: v >= task.target });
                }}
                className="rounded-full border border-border p-1.5 text-muted-foreground"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          )}

          <button
            onClick={onDelete}
            className="rounded-full p-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        {task.type === "quantity" && (
          <Progress
            value={(task.value / task.target) * 100}
            color={task.color}
            className="mt-2.5"
          />
        )}
      </div>
    </div>
  );
}

/** Adds a plain, simple (binary) task with one line of text — no modal, no
 * icon/color/quantity setup. Matches the "+ Add Todo" quick-add pattern. */
export function addQuickTask(db: Db, dateKey: string, title: string): { db: Db; task: Task } {
  const trimmed = title.trim();
  const task: Task = {
    id: uid(),
    dateKey,
    title: trimmed,
    type: "binary",
    target: 1,
    value: 0,
    done: false,
    color: undefined,
    icon: "star",
  };
  return { db: { ...db, tasks: [...db.tasks, task] }, task };
}

/**
 * Collapsible "Today's To-dos" card: a quick plain-text add row (tap to type,
 * enter to add) plus the list of tasks for the given day, using the same
 * swipe/animation behavior as the full Tasks page. Meant to be dropped into
 * Home, Tasks, or anywhere a lightweight day-scoped to-do list is useful.
 */
export function TodayTodosCard({
  db,
  dateKey,
  lang,
  t,
  onUpdate,
  defaultOpen = true,
}: {
  db: Db;
  dateKey: string;
  lang: Lang;
  t: (fa: string, en: string) => string;
  onUpdate: (fn: (d: Db) => Db) => boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [quickTitle, setQuickTitle] = useState("");

  const dayTasks = db.tasks.filter((task) => task.dateKey === dateKey);
  const doneCount = dayTasks.filter((x) => x.done).length;

  const submitQuick = () => {
    if (!quickTitle.trim()) return;
    onUpdate((d) => addQuickTask(d, dateKey, quickTitle).db);
    setQuickTitle("");
  };

  return (
    <div className="card-surface overflow-hidden !p-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-success/20 text-success">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
          <span className="text-sm font-bold text-foreground">
            {t("کارهای امروز", "Today's To-dos")}
            <span className="ms-1.5 text-xs font-normal text-muted-foreground">
              {faNum(doneCount, lang)}/{faNum(dayTasks.length, lang)}
            </span>
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3 pt-2.5">
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5">
            <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/40" />
            <input
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitQuick();
              }}
              placeholder={t("+ افزودن کار", "+ Add Todo")}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {quickTitle.trim() && (
              <button onClick={submitQuick} className="shrink-0 text-xs font-bold text-primary">
                {t("افزودن", "Add")}
              </button>
            )}
          </div>

          <AnimatedCompletionList
            key={dateKey}
            items={dayTasks}
            isCompleted={(task) => task.done}
            className="flex flex-col gap-2"
            renderItem={(task, onCompletionChange) => (
              <TaskRow
                task={task}
                settings={db.settings}
                lang={lang}
                t={t}
                onUpdate={(patch) =>
                  onUpdate((d) => ({
                    ...d,
                    tasks: d.tasks.map((x) => (x.id === task.id ? { ...x, ...patch } : x)),
                  }))
                }
                onDelete={() =>
                  onUpdate((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== task.id) }))
                }
                onCompletionChange={onCompletionChange}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}
