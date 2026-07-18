/** Shared task row + quick "Today's To-dos" card, used on both Home and Tasks pages. */
import { Bell, Check, ChevronDown, Minus, Plus, Trash2, X } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CatIcon, formatDuration, Progress } from "@/components/ui";
import { faNum, type Lang } from "@/lib/dates";
import { uid, type Db, type Task } from "@/lib/store";

/** A single task row with swipe-to-complete/undo gesture and a check-pop
 * animation, matching HabitRow's interaction pattern. */
export function TaskRow({
  task,
  lang,
  t,
  onUpdate,
  onDelete,
}: {
  task: Task;
  lang: Lang;
  t: (fa: string, en: string) => string;
  onUpdate: (patch: Partial<Task>) => void;
  onDelete: () => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [rowFlash, setRowFlash] = useState(false);
  const dragStartX = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const tint = task.color ?? "var(--primary)";
  const SWIPE_THRESHOLD = 76;

  const toggleDone = (next: boolean) => {
    onUpdate({ done: next, value: next ? task.target : task.value });
    setRowFlash(true);
    setTimeout(() => setRowFlash(false), 300);
    if (next) {
      setJustCompleted(true);
      setTimeout(() => setJustCompleted(false), 350);
    }
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    dragStartX.current = e.clientX;
    pointerId.current = e.pointerId;
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (dragStartX.current === null || pointerId.current !== e.pointerId) return;
    setDragX(Math.max(-120, Math.min(120, e.clientX - dragStartX.current)));
  };
  const endDrag = () => {
    if (dragStartX.current === null) return;
    if (dragX > SWIPE_THRESHOLD && !task.done) toggleDone(true);
    else if (-dragX > SWIPE_THRESHOLD && task.done) toggleDone(false);
    dragStartX.current = null;
    pointerId.current = null;
    setDragging(false);
    setDragX(0);
  };

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* swipe background hints */}
      <div className="absolute inset-0 flex items-center justify-between px-5">
        <span
          className="flex items-center gap-1 text-xs font-bold text-success transition-opacity"
          style={{ opacity: dragX > 20 ? Math.min(1, dragX / SWIPE_THRESHOLD) : 0 }}
        >
          <Check className="h-4 w-4" strokeWidth={3} /> {t("انجام شد", "Done")}
        </span>
        <span
          className="flex items-center gap-1 text-xs font-bold text-destructive transition-opacity"
          style={{ opacity: -dragX > 20 ? Math.min(1, -dragX / SWIPE_THRESHOLD) : 0 }}
        >
          {t("لغو", "Undo")} <X className="h-4 w-4" strokeWidth={3} />
        </span>
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => dragging && endDrag()}
        className={`card-surface relative touch-pan-y p-3.5 ${dragging ? "" : "transition-all duration-300"} ${rowFlash ? "animate-row-flash" : ""}`}
        style={{
          backgroundColor: task.done ? `${tint}22` : undefined,
          borderColor: task.done ? `${tint}55` : undefined,
          transform: `translateX(${dragX}px)`,
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => toggleDone(!task.done)}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-90 ${
              task.done ? "border-transparent text-white" : "border-border text-transparent hover:border-primary"
            }`}
            style={task.done ? { backgroundColor: tint } : undefined}
          >
            <Check className={`h-5 w-5 ${justCompleted ? "animate-check-pop" : ""}`} strokeWidth={3} />
          </button>

          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: tint }}
          >
            <CatIcon icon={task.icon ?? "star"} className="h-3.5 w-3.5" />
          </span>

          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium ${task.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
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
                  onUpdate({ value: v, done: v >= task.target });
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
                  onUpdate({ value: v, done: v >= task.target });
                }}
                className="rounded-full border border-border p-1.5 text-muted-foreground"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          )}

          <button onClick={onDelete} className="rounded-full p-1.5 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        {task.type === "quantity" && (
          <Progress value={(task.value / task.target) * 100} color={task.color} className="mt-2.5" />
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
  onUpdate: (fn: (d: Db) => Db) => void;
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
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between p-4">
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
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
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

          {dayTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              lang={lang}
              t={t}
              onUpdate={(patch) => onUpdate((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === task.id ? { ...x, ...patch } : x)) }))}
              onDelete={() => onUpdate((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== task.id) }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
