/** Shared task row + quick "Today's To-dos" card, used on both Home and Tasks pages. */
import {
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatedCompletionList } from "@/components/AnimatedCompletionList";
import { useHorizontalDrag } from "@/components/useHorizontalDrag";
import {
  Button,
  CatIcon,
  CATEGORY_ICONS,
  DatePickerCalendar,
  DurationPicker,
  formatDuration,
  Input,
  Modal,
  Progress,
  TimePicker24,
} from "@/components/ui";
import { faNum, formatDate, type Calendar, type Lang } from "@/lib/dates";
import {
  shouldTriggerCompletionFeedback,
  triggerCompletionFeedback,
} from "@/lib/completion-feedback";
import { CATEGORY_COLOR_CHOICES } from "@/lib/presets";
import { uid, type Db, type Settings, type Task } from "@/lib/store";
import { isTaskOverdue, tasksVisibleOn } from "@/lib/deadlines";

const TASK_DEFAULT_COLOR = CATEGORY_COLOR_CHOICES[0];
const TASK_DEFAULT_ICON = "star";

export interface TaskDraft {
  id?: string;
  dateKey: string;
  title: string;
  type: Task["type"];
  target: number;
  unitKind: NonNullable<Task["unitKind"]>;
  note: string;
  reminderOn: boolean;
  reminderTime: string;
  deadlineOn: boolean;
  deadlineDate: string;
  deadlineTime: string;
  color: string;
  icon: string;
}

export function emptyTaskDraft(dateKey: string): TaskDraft {
  return {
    dateKey,
    title: "",
    type: "binary",
    target: 1,
    unitKind: "count",
    note: "",
    reminderOn: false,
    reminderTime: "09:00",
    deadlineOn: false,
    deadlineDate: dateKey,
    deadlineTime: "18:00",
    color: TASK_DEFAULT_COLOR,
    icon: TASK_DEFAULT_ICON,
  };
}

export function taskToDraft(task: Task): TaskDraft {
  const reminderTime = task.reminderAt?.match(/T(\d{2}:\d{2})/)?.[1] ?? "09:00";
  const deadlineMatch = task.deadlineAt?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  return {
    id: task.id,
    dateKey: task.dateKey,
    title: task.title,
    type: task.type,
    target: task.target,
    unitKind: task.unitKind ?? "count",
    note: task.note ?? "",
    reminderOn: Boolean(task.reminderAt),
    reminderTime,
    deadlineOn: Boolean(deadlineMatch),
    deadlineDate: deadlineMatch?.[1] ?? task.dateKey,
    deadlineTime: deadlineMatch?.[2] ?? "18:00",
    color: task.color ?? TASK_DEFAULT_COLOR,
    icon: task.icon ?? TASK_DEFAULT_ICON,
  };
}

export function draftToTask(draft: TaskDraft, existing?: Task): Task {
  const isQuantity = draft.type === "quantity";
  const isTime = isQuantity && draft.unitKind === "time";
  const target = isQuantity ? Math.max(isTime ? 1 / 60 : 1, draft.target) : 1;
  const previousValue = Math.max(0, existing?.value ?? 0);
  const value = isQuantity ? previousValue : existing?.done ? 1 : 0;
  const done = isQuantity ? value >= target : Boolean(existing?.done);

  return {
    id: existing?.id ?? draft.id ?? uid(),
    dateKey: draft.dateKey,
    title: draft.title.trim(),
    type: draft.type,
    target,
    value,
    done,
    note: draft.note.trim() || undefined,
    unitKind: isQuantity ? draft.unitKind : undefined,
    reminderAt: draft.reminderOn ? `${draft.dateKey}T${draft.reminderTime}` : null,
    deadlineAt: draft.deadlineOn ? `${draft.deadlineDate}T${draft.deadlineTime}` : null,
    color: draft.color,
    icon: draft.icon,
  };
}

export function nextQuickTaskColor(tasks: Task[], dateKey: string): string {
  const dayTasks = tasks.filter((task) => task.dateKey === dateKey);
  const lastColor = [...dayTasks].reverse().find((task) => task.color)?.color;
  const lastIndex = lastColor ? CATEGORY_COLOR_CHOICES.indexOf(lastColor) : -1;
  const nextIndex = lastIndex >= 0 ? lastIndex + 1 : dayTasks.length;
  return CATEGORY_COLOR_CHOICES[nextIndex % CATEGORY_COLOR_CHOICES.length];
}

export function enableTaskReminderNotifications({
  t,
}: {
  updatePreferences: (patch: Partial<Settings>) => void;
  t: (fa: string, en: string) => string;
}) {
  toast.warning(
    t(
      "کار ذخیره شد؛ برای دریافت یادآوری، اعلان‌ها را از تنظیمات فعال کن.",
      "Task saved; enable notifications in Settings to receive its reminder.",
    ),
  );
}

export function TaskFormModal({
  open,
  draft,
  setDraft,
  onClose,
  onSave,
  cal,
  lang,
  t,
}: {
  open: boolean;
  draft: TaskDraft;
  setDraft: (update: TaskDraft | ((current: TaskDraft) => TaskDraft)) => void;
  onClose: () => void;
  onSave: () => void;
  cal: Calendar;
  lang: Lang;
  t: (fa: string, en: string) => string;
}) {
  const [dateOpen, setDateOpen] = useState(false);
  const [reminderPickerOpen, setReminderPickerOpen] = useState(false);
  const [deadlineDateOpen, setDeadlineDateOpen] = useState(false);
  const [deadlineTimeOpen, setDeadlineTimeOpen] = useState(false);
  const patchDraft = (patch: Partial<TaskDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft.id ? t("ویرایش کار", "Edit task") : t("کار جدید", "New task")}
      wide
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("تاریخ کار", "Task date")}
          </p>
          <button
            type="button"
            onClick={() => setDateOpen((value) => !value)}
            className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm font-bold text-foreground hover:bg-secondary"
          >
            <span>{formatDate(draft.dateKey, cal, lang)}</span>
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </button>
          {dateOpen && (
            <div className="mt-2">
              <DatePickerCalendar
                value={draft.dateKey}
                onChange={(dateKey) => {
                  patchDraft({ dateKey });
                  setDateOpen(false);
                }}
                cal={cal}
                lang={lang}
              />
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("عنوان کار", "Task title")}
          </p>
          <Input
            value={draft.title}
            onChange={(event) => patchDraft({ title: event.target.value })}
            placeholder={t("مثلاً: آماده‌کردن گزارش", "e.g. Prepare the report")}
            autoFocus
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("نوع سنجش", "Measurement")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => patchDraft({ type: "binary", target: 1 })}
              className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                draft.type === "binary"
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {t("انجام شد / نشد", "Done / not done")}
            </button>
            <button
              type="button"
              onClick={() =>
                patchDraft({
                  type: "quantity",
                  target: draft.target > 1 ? draft.target : 10,
                })
              }
              className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                draft.type === "quantity"
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {t("مقداری", "Quantity")}
            </button>
          </div>
        </div>

        {draft.type === "quantity" && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t("واحد سنجش", "Unit type")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    patchDraft({
                      unitKind: "count",
                      target: draft.target > 0 ? draft.target : 10,
                    })
                  }
                  className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                    draft.unitKind === "count"
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {t("تعدادی (عدد)", "Count (number)")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    patchDraft({
                      unitKind: "time",
                      target: draft.target > 0 ? draft.target : 25,
                    })
                  }
                  className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                    draft.unitKind === "time"
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {t("زمانی (ساعت/دقیقه/ثانیه)", "Time (hr/min/sec)")}
                </button>
              </div>
            </div>

            {draft.unitKind === "time" ? (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {t("مدت‌زمان هدف", "Target duration")}
                </p>
                <DurationPicker
                  totalMinutes={draft.target}
                  onChange={(target) => patchDraft({ target })}
                  lang={lang}
                  t={t}
                />
              </div>
            ) : (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {t("مقدار هدف", "Target amount")}
                </p>
                <Input
                  type="number"
                  inputMode="decimal"
                  dir="ltr"
                  min="1"
                  value={draft.target || ""}
                  onChange={(event) => patchDraft({ target: Number(event.target.value) || 0 })}
                  className="text-center"
                />
              </div>
            )}
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("آیکون", "Icon")}</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(CATEGORY_ICONS).map((iconKey) => (
              <button
                key={iconKey}
                type="button"
                onClick={() => patchDraft({ icon: iconKey })}
                aria-label={t(`انتخاب آیکون ${iconKey}`, `Choose ${iconKey} icon`)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
                  draft.icon === iconKey
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                <CatIcon icon={iconKey} className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("رنگ", "Color")}</p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_COLOR_CHOICES.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => patchDraft({ color })}
                aria-label={t(`انتخاب رنگ ${color}`, `Choose color ${color}`)}
                className={`h-7 w-7 rounded-full transition-transform ${
                  draft.color === color
                    ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card"
                    : ""
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("یادداشت", "Note")}</p>
          <Input
            value={draft.note}
            onChange={(event) => patchDraft({ note: event.target.value })}
            placeholder={t("اختیاری", "Optional")}
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("یادآوری در همین روز", "Reminder on this day")}
            </p>
            <button
              type="button"
              onClick={() => {
                const reminderOn = !draft.reminderOn;
                patchDraft({ reminderOn });
                if (!reminderOn) setReminderPickerOpen(false);
              }}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                draft.reminderOn ? "bg-primary" : "bg-secondary"
              }`}
              role="switch"
              aria-checked={draft.reminderOn}
              aria-label={t("یادآوری", "Reminder")}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                  draft.reminderOn ? "start-5.5" : "start-0.5"
                }`}
              />
            </button>
          </div>
          {draft.reminderOn && (
            <div className="mt-2 rounded-2xl border border-border p-3">
              <button
                type="button"
                onClick={() => setReminderPickerOpen((value) => !value)}
                className="w-full text-center text-sm font-bold text-foreground"
              >
                {draft.reminderTime}
              </button>
              {reminderPickerOpen && (
                <div className="mt-2">
                  <TimePicker24
                    value={draft.reminderTime}
                    onChange={(reminderTime) => patchDraft({ reminderTime })}
                    lang={lang}
                    t={t}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground">{t("ددلاین", "Deadline")}</p>
            <button
              type="button"
              role="switch"
              aria-checked={draft.deadlineOn}
              aria-label={t("ددلاین", "Deadline")}
              onClick={() => {
                const deadlineOn = !draft.deadlineOn;
                patchDraft({ deadlineOn, deadlineDate: draft.deadlineDate || draft.dateKey });
                if (!deadlineOn) {
                  setDeadlineDateOpen(false);
                  setDeadlineTimeOpen(false);
                }
              }}
              className={`relative h-6 w-11 rounded-full transition-colors ${draft.deadlineOn ? "bg-primary" : "bg-secondary"}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${draft.deadlineOn ? "start-5.5" : "start-0.5"}`}
              />
            </button>
          </div>
          {draft.deadlineOn && (
            <div className="mt-2 rounded-2xl border border-border p-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeadlineDateOpen((value) => !value)}
                  className="w-full rounded-xl border border-border px-2 py-2 text-xs font-bold text-foreground"
                >
                  {formatDate(draft.deadlineDate, cal, lang)}
                </button>
                <button
                  type="button"
                  onClick={() => setDeadlineTimeOpen((value) => !value)}
                  className="w-full rounded-xl border border-border px-2 py-2 text-xs font-bold text-foreground"
                  dir="ltr"
                >
                  {draft.deadlineTime}
                </button>
              </div>
              {deadlineDateOpen && (
                <div className="mt-2">
                  <DatePickerCalendar
                    value={draft.deadlineDate}
                    onChange={(deadlineDate) => {
                      patchDraft({ deadlineDate });
                      setDeadlineDateOpen(false);
                    }}
                    cal={cal}
                    lang={lang}
                  />
                </div>
              )}
              {deadlineTimeOpen && (
                <div className="mt-2">
                  <TimePicker24
                    value={draft.deadlineTime}
                    onChange={(deadlineTime) => patchDraft({ deadlineTime })}
                    lang={lang}
                    t={t}
                  />
                </div>
              )}
            </div>
          )}
          {draft.deadlineOn && draft.deadlineDate < draft.dateKey && (
            <p className="mt-1 text-[10px] text-destructive">
              {t(
                "ددلاین نمی‌تواند قبل از تاریخ شروع باشد.",
                "Deadline cannot be before the start date.",
              )}
            </p>
          )}
        </div>

        <Button
          onClick={onSave}
          disabled={
            !draft.title.trim() ||
            (draft.type === "quantity" && draft.target <= 0) ||
            (draft.deadlineOn && draft.deadlineDate < draft.dateKey)
          }
        >
          {draft.id ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {draft.id ? t("ذخیره تغییرات", "Save changes") : t("افزودن کار", "Add task")}
        </Button>
      </div>
    </Modal>
  );
}

/** A single task row with swipe-to-complete/undo gesture and a check-pop
 * animation, matching HabitRow's interaction pattern. */
export function TaskRow({
  task,
  settings,
  lang,
  t,
  onUpdate,
  onDelete,
  onEdit,
  onCompletionChange,
}: {
  task: Task;
  settings: Pick<Settings, "completionSoundEnabled" | "hapticsEnabled">;
  lang: Lang;
  t: (fa: string, en: string) => string;
  onUpdate: (patch: Partial<Task>) => boolean;
  onDelete: () => void;
  onEdit?: () => void;
  onCompletionChange?: (completed: boolean) => void;
}) {
  const [justCompleted, setJustCompleted] = useState(false);
  const [rowFlash, setRowFlash] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const doneHintRef = useRef<HTMLSpanElement>(null);
  const undoHintRef = useRef<HTMLSpanElement>(null);
  const suppressClickUntil = useRef(0);
  const tint = task.color ?? "var(--primary)";
  const overdue = isTaskOverdue(task);
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
            onPointerDown={(event) => event.stopPropagation()}
            aria-label={t("تغییر وضعیت انجام کار", "Toggle task completion")}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-90 ${
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
            {overdue && (
              <span className="inline-flex rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold text-destructive">
                {t("به‌تعویق‌افتاده", "Overdue")}
              </span>
            )}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {task.type === "quantity" && (
                <span dir="ltr" className="shrink-0 font-medium">
                  {task.unitKind === "time"
                    ? `${formatDuration(task.value, lang)} / ${formatDuration(task.target, lang)}`
                    : `${faNum(task.value, lang)} / ${faNum(task.target, lang)}`}
                </span>
              )}
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
              {task.deadlineAt && (
                <span className="flex items-center gap-0.5">
                  <CalendarDays className="h-2.5 w-2.5" />
                  {t("ددلاین", "Deadline")}:{" "}
                  {new Date(task.deadlineAt).toLocaleString(lang === "fa" ? "fa-IR" : "en-US", {
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

          {onEdit && (
            <button
              onClick={onEdit}
              aria-label={t("ویرایش کار", "Edit task")}
              className="rounded-full p-1.5 text-muted-foreground hover:text-primary"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}

          <button
            onClick={onDelete}
            aria-label={t("حذف کار", "Delete task")}
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
    color: nextQuickTaskColor(db.tasks, dateKey),
    icon: TASK_DEFAULT_ICON,
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
  cal,
  lang,
  t,
  onUpdate,
  onReorder,
  onReorderStart,
  onReminderRequested,
  defaultOpen = true,
}: {
  db: Db;
  dateKey: string;
  cal: Calendar;
  lang: Lang;
  t: (fa: string, en: string) => string;
  onUpdate: (fn: (d: Db) => Db) => boolean;
  onReorder?: (orderedIds: string[]) => void;
  onReorderStart?: () => void;
  onReminderRequested?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [quickTitle, setQuickTitle] = useState("");
  const [editDraft, setEditDraft] = useState<TaskDraft | null>(null);

  const dayTasks = tasksVisibleOn(db.tasks, dateKey);
  const doneCount = dayTasks.filter((x) => x.done).length;

  const submitQuick = () => {
    if (!quickTitle.trim()) return;
    onUpdate((d) => addQuickTask(d, dateKey, quickTitle).db);
    setQuickTitle("");
  };

  const saveEdit = () => {
    if (!editDraft?.id || !editDraft.title.trim()) return;
    const existing = db.tasks.find((task) => task.id === editDraft.id);
    if (!existing) return;
    const nextTask = draftToTask(editDraft, existing);
    const accepted = onUpdate((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === nextTask.id ? nextTask : task)),
    }));
    if (!accepted) return;
    if (nextTask.reminderAt && !db.settings.notificationsEnabled) onReminderRequested?.();
    setEditDraft(null);
  };

  return (
    <>
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
              onReorder={onReorder}
              onReorderStart={onReorderStart}
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
                  onEdit={() => setEditDraft(taskToDraft(task))}
                  onCompletionChange={onCompletionChange}
                />
              )}
            />
          </div>
        )}
      </div>
      {editDraft && (
        <TaskFormModal
          open
          draft={editDraft}
          setDraft={(next) =>
            setEditDraft((current) =>
              typeof next === "function" ? next(current ?? editDraft) : next,
            )
          }
          onClose={() => setEditDraft(null)}
          onSave={saveEdit}
          cal={cal}
          lang={lang}
          t={t}
        />
      )}
    </>
  );
}
