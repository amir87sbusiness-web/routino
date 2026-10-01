import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  Clock3,
  MoreVertical,
  Pencil,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { AnimatedCompletionList } from "@/components/AnimatedCompletionList";
import {
  draftToHabit,
  emptyDraft,
  HabitFormModal,
  HabitRow,
  type HabitDraft,
} from "@/components/habits";
import {
  draftToTask,
  emptyTaskDraft,
  TaskFormModal,
  TaskRow,
  type TaskDraft,
} from "@/components/tasks";
import {
  Button,
  Card,
  CatIcon,
  DatePickerCalendar,
  EmptyState,
  Input,
  Modal,
  Progress,
  formatDuration,
} from "@/components/ui";
import { faNum, formatDate, todayKey, type Calendar, type Lang } from "@/lib/dates";
import {
  shouldTriggerCompletionFeedback,
  triggerCompletionFeedback,
} from "@/lib/completion-feedback";
import {
  addGoalItem,
  completeFullyProgressedGoals,
  createCustomGoalItem,
  createGoalItem,
  goalHasSource,
  goalDeadlineState,
  goalOverview,
  highestCrossedGoalMilestone,
  goalProgress,
  MAX_GOAL_TIME_TARGET_MINUTES,
  reconfigureCustomGoalItem,
  reopenRegressedGoals,
} from "@/lib/goals";
import {
  logKey,
  uid,
  type Habit,
  type Db,
  type Goal,
  type GoalItem,
  type GoalItemMeasure,
  type GoalPriority,
} from "@/lib/store";

type T = (fa: string, en: string) => string;
type Update = (fn: (db: Db) => Db) => boolean;

interface SharedProps {
  db: Db;
  update: Update;
  t: T;
  lang: Lang;
  cal: Calendar;
}

function percentLabel(value: number, lang: Lang) {
  return `${faNum(value, lang)}٪`;
}

const GOAL_PRIORITIES: GoalPriority[] = ["critical", "high", "normal", "low"];
const GOAL_PRIORITY_COLORS: Record<GoalPriority, { light: string; dark: string }> = {
  critical: { light: "#6b21a8", dark: "#d8b4fe" },
  high: { light: "#b91c1c", dark: "#fca5a5" },
  normal: { light: "#854d0e", dark: "#fde047" },
  low: { light: "#166534", dark: "#86efac" },
};

function priorityLabel(priority: GoalPriority, t: T) {
  if (priority === "low") return t("کم", "Low");
  if (priority === "normal") return t("متوسط", "Medium");
  if (priority === "high") return t("زیاد", "High");
  return t("خیلی مهم", "Critical");
}

function deadlineLabel(goal: Goal, lang: Lang, t: T, now = Date.now()) {
  const state = goalDeadlineState(goal, now);
  if (state.kind === "none") return null;
  if (state.kind === "remaining")
    return state.days === 0
      ? t("مهلت تا امروز", "Due today")
      : t(`${faNum(state.days, lang)} روز مانده`, `${state.days} days left`);
  if (state.kind === "overdue")
    return t(`${faNum(state.days, lang)} روز عقب‌افتاده`, `${state.days} days overdue`);
  if (state.kind === "completed-late")
    return t(
      `${faNum(state.days, lang)} روز دیرتر تمام شد`,
      `Completed ${state.days} days late`,
    );
  return t("به‌موقع تمام شد", "Completed on time");
}

function GoalCelebration({
  milestone,
  title,
  onClose,
  t,
  lang,
}: {
  milestone: 50 | 75 | 100 | null;
  title: string;
  onClose: () => void;
  t: T;
  lang: Lang;
}) {
  return (
    <Modal open={milestone !== null} onClose={onClose}>
      {milestone !== null && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-3xl">
            {milestone === 100 ? "🏆" : "🎉"}
          </span>
          <h3 className="text-lg font-black text-foreground">
            {milestone === 100
              ? t("هدفت رو انجام دادی!", "Goal completed!")
              : t(
                  `به ${faNum(milestone, lang)}٪ هدفت رسیدی!`,
                  `You reached ${milestone}%!`,
                )}
          </h3>
          <p className="text-sm text-muted-foreground">{title}</p>
          <Button className="w-full" onClick={onClose}>{t("عالیه", "Great")}</Button>
        </div>
      )}
    </Modal>
  );
}

function queueGoalCompletionCelebration(goal: Goal) {
  try {
    sessionStorage.setItem(
      "routino:goal-celebration",
      JSON.stringify({ title: goal.title, milestone: 100 }),
    );
  } catch {
    // Completion must not depend on optional device storage.
  }
}

function splitLocalDateTime(value: string | null | undefined, fallbackTime: string) {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  return { date: match?.[1] ?? todayKey(), time: match?.[2] ?? fallbackTime, on: Boolean(match) };
}

function formatGoalDateTime(value: string, cal: Calendar, lang: Lang) {
  const [date, time] = value.split("T");
  return `${formatDate(date, cal, lang)} · ${time}`;
}

function GoalDateField({
  label,
  value,
  defaultTime = "09:00",
  onChange,
  cal,
  lang,
  t,
}: {
  label: string;
  value: string | null;
  defaultTime?: string;
  onChange: (value: string | null) => void;
  cal: Calendar;
  lang: Lang;
  t: T;
}) {
  const [open, setOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const parts = splitLocalDateTime(value, defaultTime);
  return (
    <div className="rounded-xl border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-xs font-bold"
      >
        <span>{label}</span>
        <span className="text-muted-foreground">
          {value ? formatGoalDateTime(value, cal, lang) : t("خاموش", "Off")}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          <button
            type="button"
            onClick={() => setCalendarOpen(!calendarOpen)}
            className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-xs"
          >
            {formatDate(parts.date, cal, lang)}
            <CalendarDays className="h-4 w-4" />
          </button>
          {calendarOpen && (
            <div className="mx-auto w-full max-w-72">
              <DatePickerCalendar
                value={parts.date}
                cal={cal}
                lang={lang}
                onChange={(date) => {
                  onChange(date + "T" + parts.time);
                  setCalendarOpen(false);
                }}
              />
            </div>
          )}
          <label className="flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
            {t("ساعت", "Time")}
            <Input
              aria-label={label + " " + t("ساعت", "time")}
              type="time"
              value={parts.time}
              onInput={(event) => {
                if (event.currentTarget.value)
                  onChange(parts.date + "T" + event.currentTarget.value);
              }}
              className="!w-32 !py-1.5 text-center"
              dir="ltr"
            />
          </label>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1 !py-1.5 !text-xs"
              onClick={() => {
                onChange(parts.date + "T" + parts.time);
                setOpen(false);
              }}
            >
              {t("ثبت", "Set")}
            </Button>
            {value && (
              <Button
                variant="ghost"
                className="!py-1.5 !text-xs text-destructive"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                {t("حذف", "Remove")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LongDurationInput({
  minutes,
  onChange,
  t,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  t: T;
}) {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.floor(minutes % 60);
  return (
    <div className="grid grid-cols-2 gap-2" dir="ltr">
      <label className="text-center text-[10px] text-muted-foreground">
        {t("ساعت", "Hours")}
        <Input
          aria-label={t("ساعت هدف", "Target hours")}
          type="number"
          min={0}
          max={9999}
          value={hours}
          onChange={(event) =>
            onChange(
              Math.min(
                MAX_GOAL_TIME_TARGET_MINUTES,
                Math.max(0, Number(event.target.value) || 0) * 60 + remainder,
              ),
            )
          }
          className="mt-1 text-center"
        />
      </label>
      <label className="text-center text-[10px] text-muted-foreground">
        {t("دقیقه", "Minutes")}
        <Input
          aria-label={t("دقیقه هدف", "Target minutes")}
          type="number"
          min={0}
          max={59}
          value={remainder}
          onChange={(event) =>
            onChange(
              Math.min(
                MAX_GOAL_TIME_TARGET_MINUTES,
                hours * 60 + Math.min(59, Math.max(0, Number(event.target.value) || 0)),
              ),
            )
          }
          className="mt-1 text-center"
        />
      </label>
    </div>
  );
}

function GoalCard({ db, goal, lang, t }: { db: Db; goal: Goal; lang: Lang; t: T }) {
  const progress = goalProgress(db, goal);
  const category = db.categories.find((candidate) => candidate.id === goal.categoryId);
  const deadline = deadlineLabel(goal, lang, t);
  const completed = goal.status === "completed";
  return (
    <Link
      to="/goal/$goalId"
      params={{ goalId: goal.id }}
      className={`card-surface block p-4 transition-transform active:scale-[0.99] ${completed ? "opacity-60 grayscale" : "goal-priority-card"}`}
      style={completed ? undefined : {
        "--goal-priority-color": GOAL_PRIORITY_COLORS[goal.priority].light,
        "--goal-priority-dark": GOAL_PRIORITY_COLORS[goal.priority].dark,
      } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: category?.color ?? "var(--primary)" }}
        >
          {category ? (
            <CatIcon icon={category.icon} className="h-5 w-5" />
          ) : (
            <Target className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className={`truncate text-sm font-black text-foreground ${completed ? "line-through" : ""}`}>{goal.title}</h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${completed ? "bg-secondary text-muted-foreground" : "goal-priority-label"}`}>
              {priorityLabel(goal.priority, t)}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {faNum(goal.items.length, lang)} {t("آیتم", "items")}
            {goal.deadlineAt
              ? ` · ${formatGoalDateTime(goal.deadlineAt, db.settings.calendar, lang)}`
              : ""}
          </p>
          {deadline && (
            <p className={`mt-1 text-[10px] font-medium ${goalDeadlineState(goal).kind === "overdue" || goalDeadlineState(goal).kind === "completed-late" ? "text-destructive" : "text-muted-foreground"}`}>
              {deadline}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Progress value={progress.percent} color={completed ? undefined : "var(--goal-ink)"} className="flex-1" />
            <span className="text-[10px] font-bold text-muted-foreground">
              {percentLabel(progress.percent, lang)}
            </span>
          </div>
        </div>
        <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground ltr:rotate-180" />
      </div>
    </Link>
  );
}

export function GoalsListView({ db, update, t, lang, cal }: SharedProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [reminder, setReminder] = useState("");
  const [reminderTime, setReminderTime] = useState("09:00");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Goal["priority"]>("normal");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed" | "overdue">("all");
  const [celebration, setCelebration] = useState<{ title: string; milestone: 50 | 75 | 100 } | null>(() => {
    try {
      const pending = sessionStorage.getItem("routino:goal-celebration");
      if (!pending) return null;
      sessionStorage.removeItem("routino:goal-celebration");
      return JSON.parse(pending) as { title: string; milestone: 50 | 75 | 100 };
    } catch {
      return null;
    }
  });
  const overview = goalOverview(db);
  const visibleGoals = db.goals.filter((goal) => {
    if (statusFilter === "active" && goal.status !== "active") return false;
    if (statusFilter === "completed" && goal.status !== "completed") return false;
    if (statusFilter === "overdue" && goalDeadlineState(goal).kind !== "overdue") return false;
    return true;
  }).sort((a, b) => GOAL_PRIORITIES.indexOf(a.priority) - GOAL_PRIORITIES.indexOf(b.priority));
  const active = visibleGoals.filter((goal) => goal.status === "active");
  const completed = visibleGoals.filter((goal) => goal.status === "completed");

  useEffect(() => {
    for (const candidate of db.goals) {
      const current = goalProgress(db, candidate).percent;
      try {
        const progressKey = `routino:goal-last-progress:${candidate.id}`;
        const previousRaw = localStorage.getItem(progressKey);
        if (previousRaw !== String(current)) localStorage.setItem(progressKey, String(current));
        if (previousRaw === null) continue;
        const seenKey = `routino:goal-milestones:${candidate.id}`;
        const seen = JSON.parse(localStorage.getItem(seenKey) ?? "[]") as number[];
        const crossed = highestCrossedGoalMilestone(Number(previousRaw), current, seen);
        if (!crossed) continue;
        localStorage.setItem(seenKey, JSON.stringify([...seen, crossed]));
        setCelebration({ title: candidate.title, milestone: crossed });
        break;
      } catch {
        // Milestone snapshots are device-local and best-effort.
      }
    }
    const completedNow = db.goals.find(
      (goal) => goal.status === "active" && goal.items.length && goalProgress(db, goal).complete,
    );
    if (!completedNow) return;
    if (update((current) => completeFullyProgressedGoals(current))) {
      setCelebration({ title: completedNow.title, milestone: 100 });
      try {
        const key = `routino:goal-milestones:${completedNow.id}`;
        const seen = JSON.parse(localStorage.getItem(key) ?? "[]") as number[];
        if (!seen.includes(100)) localStorage.setItem(key, JSON.stringify([...seen, 100]));
      } catch {
        // Celebration persistence is device-local and best-effort.
      }
    }
  }, [db, update]);

  const createGoal = () => {
    if (!title.trim()) return;
    const goal: Goal = {
      id: uid(),
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      categoryId,
      reminderAt: reminder ? `${reminder}T${reminderTime}` : null,
      deadlineAt: deadline ? `${deadline}T${deadlineTime}` : null,
      priority,
      status: "active",
      items: [],
      createdAt: Date.now(),
    };
    if (!update((current) => ({ ...current, goals: [...current.goals, goal] }))) return;
    if (reminder && !db.settings.notificationsEnabled)
      toast.warning(
        t(
          "هدف ذخیره شد؛ برای دریافت یادآوری، اعلان‌ها را از تنظیمات فعال کن.",
          "Goal saved; enable notifications in Settings to receive its reminder.",
        ),
      );
    setOpen(false);
    setTitle("");
    setDescription("");
    setDeadline("");
    setReminder("");
    setCategoryId(null);
    setPriority("normal");
  };

  return (
    <div data-guide-scope="goals" className="page-stagger flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 data-guide="intro" className="text-xl font-black text-foreground">{t("هدف‌ها", "Goals")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("چند قدم ساده برای رسیدن به چیزی که مهمه.", "Simple steps toward what matters.")}
          </p>
        </div>
        <Button data-guide="create" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("هدف جدید", "New goal")}
        </Button>
      </div>

      <Card data-guide="summary" className="overflow-hidden">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-black text-foreground">{t("خلاصه هدف‌ها", "Goals overview")}</h2>
            <p className="mt-2 text-3xl font-black tabular-nums text-foreground">{percentLabel(overview.percent, lang)}</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <span><b className="block text-sm text-foreground">{faNum(overview.active, lang)}</b><small className="text-[9px] text-muted-foreground">{t("فعال", "Active")}</small></span>
            <span><b className="block text-sm text-success">{faNum(overview.completed, lang)}</b><small className="text-[9px] text-muted-foreground">{t("تمام", "Done")}</small></span>
            <span><b className="block text-sm text-destructive">{faNum(overview.overdue, lang)}</b><small className="text-[9px] text-muted-foreground">{t("دیرکرد", "Late")}</small></span>
          </div>
        </div>
        <div className="mt-4" aria-label={t("پیشرفت کل هدف‌ها", "Overall goal progress")}>
          <Progress value={overview.percent} color={overview.percent === 100 ? "var(--success)" : undefined} />
        </div>
      </Card>

      <div data-guide="filters" className="flex flex-col gap-2">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {(["all", "active", "completed", "overdue"] as const).map((value) => (
            <button key={value} onClick={() => setStatusFilter(value)} className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-bold ${statusFilter === value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>
              {value === "all" ? t("همه", "All") : value === "active" ? t("فعال", "Active") : value === "completed" ? t("انجام‌شده", "Completed") : t("عقب‌افتاده", "Overdue")}
            </button>
          ))}
        </div>
      </div>

      <div data-guide="list" className="flex flex-col gap-5">
      {active.length === 0 ? (
        <Card>
          <EmptyState emoji="🎯" text={t("هنوز هدف فعالی نداری.", "No active goals yet.")} />
        </Card>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-foreground">{t("فعال", "Active")}</h2>
          {active.map((goal) => (
            <GoalCard key={goal.id} db={db} goal={goal} lang={lang} t={t} />
          ))}
        </section>
      )}

      {completed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-bold text-muted-foreground">{t("انجام‌شده", "Completed")}</h2>
          {completed.map((goal) => (
            <GoalCard key={goal.id} db={db} goal={goal} lang={lang} t={t} />
          ))}
        </section>
      )}

      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t("ساخت هدف", "Create goal")}>
        <div className="flex flex-col gap-3">
          <Input
            value={title}
            onInput={(event) => setTitle(event.currentTarget.value)}
            maxLength={256}
            placeholder={t("مثلاً: آمادگی برای ماراتن", "e.g. Get ready for a marathon")}
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4000}
            placeholder={t("توضیح کوتاه (اختیاری)", "Short description (optional)")}
            className="min-h-20 w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
          />
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              {t("دسته‌بندی", "Category")}
            </p>
            <div className="flex flex-wrap gap-1">
              {db.categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setCategoryId(categoryId === category.id ? null : category.id)}
                  className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs ${categoryId === category.id ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"}`}
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-md text-white"
                    style={{ backgroundColor: category.color }}
                  >
                    <CatIcon icon={category.icon} className="h-3 w-3" />
                  </span>
                  {lang === "fa" ? category.nameFa : category.nameEn}
                </button>
              ))}
            </div>
          </div>
          <GoalDateField
            label={t("یادآوری", "Reminder")}
            value={reminder ? reminder + "T" + reminderTime : null}
            onChange={(value) => {
              setReminder(value?.split("T")[0] ?? "");
              setReminderTime(value?.split("T")[1] ?? "09:00");
            }}
            cal={cal}
            lang={lang}
            t={t}
          />
          <GoalDateField
            label={t("ددلاین", "Deadline")}
            value={deadline ? deadline + "T" + deadlineTime : null}
            defaultTime="18:00"
            onChange={(value) => {
              setDeadline(value?.split("T")[0] ?? "");
              setDeadlineTime(value?.split("T")[1] ?? "18:00");
            }}
            cal={cal}
            lang={lang}
            t={t}
          />
          <div className="grid grid-cols-4 gap-1">
            {GOAL_PRIORITIES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPriority(value)}
                className={`rounded-xl border px-3 py-2 text-xs font-bold ${priority === value ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"}`}
              >
                {priorityLabel(value, t)}
              </button>
            ))}
          </div>
          <Button disabled={!title.trim()} onClick={createGoal}>
            {t("ساخت هدف", "Create goal")}
          </Button>
        </div>
      </Modal>
      <GoalCelebration milestone={celebration?.milestone ?? null} title={celebration?.title ?? ""} onClose={() => setCelebration(null)} t={t} lang={lang} />
    </div>
  );
}

type Flow = "idle" | "choose" | "habit" | "task" | "target" | "custom" | "new-habit" | "new-task";

function measureOfSource(source: Db["habits"][number] | Db["tasks"][number]): GoalItemMeasure {
  if (source.type === "binary") return "binary";
  return source.unitKind === "time" ? "time" : "count";
}

function GoalItemActions({
  timed,
  onEdit,
  onRemove,
  t,
}: {
  timed: boolean;
  onEdit: () => void;
  onRemove: () => void;
  t: T;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="shrink-0" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={t("گزینه‌های آیتم", "Item options")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rounded-full p-2 text-muted-foreground hover:bg-secondary"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("گزینه‌های آیتم", "Item options")}>
        <div className="flex flex-col gap-2">
          {timed && (
            <Link
              to="/timer"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-3 text-sm text-foreground hover:bg-secondary"
            >
              <Clock3 className="h-4 w-4" /> {t("تایمر", "Timer")}
            </Link>
          )}
          <button
            type="button"
            aria-label={t("ویرایش آیتم", "Edit item")}
            onClick={() => { setOpen(false); onEdit(); }}
            className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-3 text-sm text-foreground hover:bg-secondary"
          >
            <Pencil className="h-4 w-4" /> {t("ویرایش", "Edit")}
          </button>
          <button
            type="button"
            aria-label={t("حذف از هدف", "Remove from goal")}
            onClick={() => { setOpen(false); onRemove(); }}
            className="flex w-full items-center gap-2 rounded-xl border border-destructive/30 px-3 py-3 text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" /> {t("حذف از هدف", "Remove from goal")}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function GoalItemRow({
  item,
  itemProgress,
  db,
  lang,
  cal,
  t,
  update,
  goalId,
  onEdit,
  onRemove,
  onCompletionChange,
}: {
  item: GoalItem;
  itemProgress: ReturnType<typeof goalProgress>["items"][number];
  db: Db;
  lang: Lang;
  cal: Calendar;
  t: T;
  update: Update;
  goalId: string;
  onEdit: () => void;
  onRemove: () => void;
  onCompletionChange: (completed: boolean) => void;
}) {
  const dk = todayKey();
  const sourceHabit =
    item.kind === "source" && item.sourceType === "habit"
      ? db.habits.find((h) => h.id === item.sourceId)
      : undefined;
  const sourceTask =
    item.kind === "source" && item.sourceType === "task"
      ? db.tasks.find((task) => task.id === item.sourceId)
      : undefined;
  const updateSource: Update = (fn) => {
    const predicted = fn(db);
    const goal = predicted.goals.find((candidate) => candidate.id === goalId);
    const nextProgress = goal
      ? goalProgress(predicted, goal).items[
          goal.items.findIndex((candidate) => candidate.id === item.id)
        ]
      : undefined;
    const accepted = update(fn);
    if (accepted && nextProgress && nextProgress.complete !== itemProgress.complete)
      onCompletionChange(nextProgress.complete);
    return accepted;
  };
  // This adapter only supplies the existing HabitRow UI. Its temporary habit/log
  // never enters Db: the accepted update writes solely to the real Goal item.
  const customHabit: Habit | null =
    item.kind === "custom"
      ? {
          id: item.id,
          name: item.title,
          categoryId: db.goals.find((goal) => goal.id === goalId)?.categoryId ?? "",
          type: item.measure === "binary" ? "binary" : "quantity",
          target:
            item.measure === "binary"
              ? 1
              : item.measure === "count"
                ? item.target
                : item.targetMinutes,
          unitKind: item.measure === "time" ? "time" : "count",
          unit: item.measure === "count" ? item.unit : undefined,
          schedule: { kind: "daily" },
          monthlyGoal: null,
          reminderTime: null,
          createdAt: Date.now(),
        }
      : null;
  const customLog =
    item.kind === "custom"
      ? {
          habitId: item.id,
          dateKey: dk,
          value:
            item.measure === "binary"
              ? Number(item.value)
              : item.measure === "count"
                ? item.value
                : item.valueMinutes,
          done: itemProgress.complete,
          note: item.note,
          mood: item.mood,
        }
      : null;
  const actions = (
    <GoalItemActions timed={item.measure === "time"} onEdit={onEdit} onRemove={onRemove} t={t} />
  );
  const goalProgressDisplay = {
    percent: itemProgress.percent,
    label: percentLabel(itemProgress.percent, lang),
    valueLabel: t(
      `هدف: ${item.measure === "time" ? formatDuration(itemProgress.value, lang) : faNum(itemProgress.value, lang)} / ${item.measure === "time" ? formatDuration(itemProgress.target, lang) : faNum(itemProgress.target, lang)}`,
      `Goal: ${item.measure === "time" ? formatDuration(itemProgress.value, lang) : itemProgress.value} / ${item.measure === "time" ? formatDuration(itemProgress.target, lang) : itemProgress.target}`,
    ),
  };
  return (
    <div className="min-w-0" data-goal-item={item.kind === "source" ? item.sourceId : item.id}>
      {customHabit && customLog ? (
        <HabitRow
          db={{ ...db, habits: [customHabit], logs: { [logKey(item.id, dk)]: customLog } }}
          habit={customHabit}
          cal={cal}
          lang={lang}
          t={t}
          dk={dk}
          showWeekChecks={false}
          durationInput={(minutes, onChange) => (
            <LongDurationInput minutes={minutes} onChange={onChange} t={t} />
          )}
          goalProgress={
            item.kind !== "custom" || item.measure === "binary"
              ? undefined
              : {
                  ...goalProgressDisplay,
                  todayLabel: t(
                    `تا الان ${item.measure === "time" ? formatDuration(item.valueMinutes, lang) : faNum(item.value, lang)} انجام دادی`,
                    `Completed ${item.measure === "time" ? formatDuration(item.valueMinutes, lang) : item.value} so far`,
                  ),
                }
          }
          actionMenu={actions}
          onCompletionChange={onCompletionChange}
          onUpdate={(fn) =>
            update((current) => {
              const liveGoal = current.goals.find((goal) => goal.id === goalId);
              const live = liveGoal?.items.find((candidate) => candidate.id === item.id);
              if (!live || live.kind !== "custom" || live.measure !== item.measure) return current;
              const value =
                live.measure === "binary"
                  ? Number(live.value)
                  : live.measure === "count"
                    ? live.value
                    : live.valueMinutes;
              const temporary = {
                ...current,
                habits: [customHabit],
                logs: {
                  [logKey(item.id, dk)]: {
                    ...customLog,
                    value,
                    done: live.measure === "binary" ? live.value : value >= customHabit.target,
                    note: live.note,
                    mood: live.mood,
                  },
                },
              };
              const log = fn(temporary).logs[logKey(item.id, dk)];
              return {
                ...current,
                goals: current.goals.map((goal) =>
                  goal.id !== goalId
                    ? goal
                    : {
                        ...goal,
                        items: goal.items.map((candidate) =>
                          candidate.id !== live.id
                            ? candidate
                            : live.measure === "binary"
                              ? { ...live, value: log.done, note: log.note, mood: log.mood }
                              : live.measure === "count"
                                ? { ...live, value: log.value, note: log.note, mood: log.mood }
                                : { ...live, valueMinutes: log.value, note: log.note, mood: log.mood },
                        ),
                      },
                ),
              };
            })
          }
        />
      ) : sourceHabit && !itemProgress.needsRelink ? (
        <HabitRow
          db={db}
          habit={sourceHabit}
          cal={cal}
          lang={lang}
          t={t}
          dk={dk}
          goalProgress={{
            ...goalProgressDisplay,
            todayLabel: t(
              `امروز ${sourceHabit.unitKind === "time" ? formatDuration(db.logs[logKey(sourceHabit.id, dk)]?.value ?? 0, lang) : faNum(db.logs[logKey(sourceHabit.id, dk)]?.value ?? 0, lang)} انجام دادی`,
              `Today you completed ${sourceHabit.unitKind === "time" ? formatDuration(db.logs[logKey(sourceHabit.id, dk)]?.value ?? 0, lang) : db.logs[logKey(sourceHabit.id, dk)]?.value ?? 0}`,
            ),
          }}
          actionMenu={actions}
          onUpdate={updateSource}
        />
      ) : sourceTask && !itemProgress.needsRelink ? (
        <TaskRow
          task={sourceTask}
          settings={db.settings}
          categories={db.categories}
          lang={lang}
          t={t}
          onUpdate={(patch) =>
            updateSource((current) => ({
              ...current,
              tasks: current.tasks.map((task) =>
                task.id === sourceTask.id ? { ...task, ...patch } : task,
              ),
            }))
          }
          goalProgress={
            item.measure === "binary"
              ? undefined
              : {
                  ...goalProgressDisplay,
                  summary: t(
                    `در این هدف ${item.measure === "time" ? formatDuration(itemProgress.value, lang) : faNum(itemProgress.value, lang)} انجام شده`,
                    `${item.measure === "time" ? formatDuration(itemProgress.value, lang) : itemProgress.value} completed in this goal`,
                  ),
                }
          }
          actionMenu={actions}
        />
      ) : (
        <Card className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold">
              {item.kind === "source" ? item.sourceTitleSnapshot : ""}
            </p>
            <p className="mt-1 text-xs text-destructive">
              {itemProgress.needsRelink
                ? t("نوع مورد تغییر کرده؛ دوباره متصلش کن.", "The source type changed; reconnect it.")
                : t("مورد اصلی حذف شده است.", "The source was deleted.")}
            </p>
          </div>
          {actions}
        </Card>
      )}
    </div>
  );
}

export function GoalDetailView({
  db,
  goalId,
  update,
  t,
  lang,
  cal,
  onDeleted,
  onCompleted,
}: SharedProps & { goalId: string; onDeleted?: () => void; onCompleted?: () => void }) {
  const goal = db.goals.find((item) => item.id === goalId);
  const [flow, setFlow] = useState<Flow>("idle");
  const [source, setSource] = useState<{ type: "habit" | "task"; id: string } | null>(null);
  const [target, setTarget] = useState(1);
  const [customTitle, setCustomTitle] = useState("");
  const [customMeasure, setCustomMeasure] = useState<GoalItemMeasure>("binary");
  const [customTarget, setCustomTarget] = useState(1);
  const [customUnit, setCustomUnit] = useState("");
  const [confirmation, setConfirmation] = useState<{
    message: string;
    action: () => boolean;
  } | null>(null);
  const [customNote, setCustomNote] = useState("");
  const [editingItem, setEditingItem] = useState<GoalItem | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editReminderOn, setEditReminderOn] = useState(false);
  const [editReminderDate, setEditReminderDate] = useState(todayKey());
  const [editReminderTime, setEditReminderTime] = useState("09:00");
  const [editDeadlineOn, setEditDeadlineOn] = useState(false);
  const [editDeadlineDate, setEditDeadlineDate] = useState(todayKey());
  const [editDeadlineTime, setEditDeadlineTime] = useState("18:00");
  const [editPriority, setEditPriority] = useState<Goal["priority"]>("normal");
  const [habitDraft, setHabitDraft] = useState<HabitDraft>(() =>
    emptyDraft(db.categories[0]?.id ?? "default"),
  );
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(() => emptyTaskDraft(todayKey()));
  const [milestone, setMilestone] = useState<50 | 75 | 100 | null>(null);
  const previousPercent = useRef<number | null>(null);
  const autoCompleting = useRef(false);
  const updateWithReopening: Update = (fn) =>
    update((current) => reopenRegressedGoals(current, fn(current)));

  const progress = useMemo(() => (goal ? goalProgress(db, goal) : null), [db, goal]);
  useEffect(() => {
    if (!goal || !progress) return;
    if (goal.status === "active" && !progress.complete) autoCompleting.current = false;
    const before = previousPercent.current ?? progress.percent;
    previousPercent.current = progress.percent;
    let seen: number[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(`routino:goal-milestones:${goal.id}`) ?? "[]") as number[];
    } catch {
      seen = [];
    }
    const crossed = highestCrossedGoalMilestone(before, progress.percent, seen);
    try {
      const key = `routino:goal-last-progress:${goal.id}`;
      if (localStorage.getItem(key) !== String(progress.percent))
        localStorage.setItem(key, String(progress.percent));
    } catch {
      // Progress snapshots are device-local and best-effort.
    }
    if (crossed) {
      try {
        localStorage.setItem(
          `routino:goal-milestones:${goal.id}`,
          JSON.stringify([...seen, crossed]),
        );
      } catch {
        // Celebration dedupe is best-effort and device-local by design.
      }
      if (crossed < 100) setMilestone(crossed);
    }
    if (
      goal.status === "active" &&
      goal.items.length > 0 &&
      progress.complete &&
      !autoCompleting.current
    ) {
      autoCompleting.current = true;
      const accepted = update((current) => completeFullyProgressedGoals(current));
      if (accepted) {
        queueGoalCompletionCelebration(goal);
        triggerCompletionFeedback(db.settings);
        onCompleted?.();
      } else {
        autoCompleting.current = false;
      }
    }
  }, [db.settings, goal, onCompleted, progress, update]);
  if (!goal || !progress) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        {t("هدف پیدا نشد.", "Goal not found.")}
      </div>
    );
  }

  const patchGoal = (fn: (current: Goal) => Goal) =>
    updateWithReopening((current) => ({
      ...current,
      goals: current.goals.map((item) => (item.id === goal.id ? fn(item) : item)),
    }));

  const selectSource = (type: "habit" | "task", id: string) => {
    const selected =
      type === "habit"
        ? db.habits.find((item) => item.id === id)
        : db.tasks.find((item) => item.id === id);
    if (!selected) return;
    const measure = measureOfSource(selected);
    setSource({ type, id });
    setTarget(type === "task" && measure === "binary" ? 1 : Math.max(1, selected.target));
    setFlow("target");
  };

  const connectSource = () => {
    if (!source) return;
    const item = createGoalItem(db, source.type, source.id, target);
    patchGoal((current) => addGoalItem(current, item));
    setFlow("idle");
    setSource(null);
  };

  const addCustom = () => {
    const item =
      customMeasure === "binary"
        ? createCustomGoalItem({ title: customTitle, measure: "binary" })
        : customMeasure === "count"
          ? createCustomGoalItem({
              title: customTitle,
              measure: "count",
              target: customTarget,
              unit: customUnit.trim() || undefined,
            })
          : createCustomGoalItem({
              title: customTitle,
              measure: "time",
              targetMinutes: customTarget,
            });
    patchGoal((current) => addGoalItem(current, item));
    setFlow("idle");
    setCustomTitle("");
    setCustomMeasure("binary");
    setCustomTarget(1);
    setCustomUnit("");
  };

  const saveNewHabit = () => {
    if (!habitDraft.name.trim()) return;
    const habit = draftToHabit(habitDraft);
    const accepted = update((current) => ({ ...current, habits: [...current.habits, habit] }));
    if (!accepted) return;
    setSource({ type: "habit", id: habit.id });
    setTarget(Math.max(1, habit.target));
    setFlow("target");
  };

  const saveNewTask = () => {
    if (!taskDraft.title.trim()) return;
    const task = draftToTask(taskDraft);
    const accepted = update((current) => ({ ...current, tasks: [...current.tasks, task] }));
    if (!accepted) return;
    setSource({ type: "task", id: task.id });
    setTarget(task.type === "binary" ? 1 : Math.max(1, task.target));
    setFlow("target");
  };

  const sourceEntity = source
    ? source.type === "habit"
      ? db.habits.find((item) => item.id === source.id)
      : db.tasks.find((item) => item.id === source.id)
    : null;

  return (
    <div className="page-stagger flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <Link to="/goals" className="rounded-full p-2 text-muted-foreground hover:bg-secondary">
          <ArrowRight className="h-5 w-5 ltr:rotate-180" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-black text-foreground">{goal.title}</h1>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[9px] font-bold text-muted-foreground">
              {priorityLabel(goal.priority, t)}
            </span>
          </div>
          {goal.description && (
            <p className="mt-1 text-xs leading-6 text-muted-foreground">{goal.description}</p>
          )}
          {goal.deadlineAt && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("مهلت:", "Deadline:")} {formatGoalDateTime(goal.deadlineAt, cal, lang)}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={t("ویرایش هدف", "Edit goal")}
          onClick={() => {
            setEditTitle(goal.title);
            setEditDescription(goal.description ?? "");
            setEditCategoryId(goal.categoryId ?? null);
            const reminder = splitLocalDateTime(goal.reminderAt, "09:00");
            setEditReminderOn(reminder.on);
            setEditReminderDate(reminder.date);
            setEditReminderTime(reminder.time);
            const deadline = splitLocalDateTime(goal.deadlineAt, "18:00");
            setEditDeadlineOn(deadline.on);
            setEditDeadlineDate(deadline.date);
            setEditDeadlineTime(deadline.time);
            setEditPriority(goal.priority);
            setEditOpen(true);
          }}
          className="rounded-full p-2 text-muted-foreground hover:bg-secondary"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      <Card>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">{t("پیشرفت کل", "Overall progress")}</p>
            <p className="mt-1 text-4xl font-black tabular-nums text-foreground">
              {percentLabel(progress.percent, lang)}
            </p>
          </div>
          {goal.items.length === 0 && (
            <button
              type="button"
              aria-label={
                goal.status === "completed"
                  ? t("بازگردانی هدف", "Undo goal")
                  : t("انجام هدف", "Complete goal")
              }
              onClick={() => {
                const completed = goal.status !== "completed";
                const accepted = patchGoal((current) => ({
                  ...current,
                  status: completed ? "completed" : "active",
                  completedAt: completed ? Date.now() : null,
                }));
                if (
                  shouldTriggerCompletionFeedback({
                    source: "user",
                    mutationAccepted: accepted,
                    beforeCompleted: !completed,
                    afterCompleted: completed,
                  })
                )
                  triggerCompletionFeedback(db.settings);
                if (accepted && completed) {
                  queueGoalCompletionCelebration(goal);
                  onCompleted?.();
                }
              }}
              className={`flex h-10 w-10 items-center justify-center rounded-full border ${goal.status === "completed" ? "border-success bg-success text-white" : "border-border bg-secondary text-muted-foreground"}`}
            >
              <Check className="h-5 w-5" />
            </button>
          )}
        </div>
        <Progress value={progress.percent} className="h-3" />
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
          <p>
            <b className="text-foreground">{faNum(progress.items.filter((item) => item.complete).length, lang)}</b>
            {t(` از ${faNum(goal.items.length, lang)} آیتم انجام شده`, ` of ${goal.items.length} items completed`)}
          </p>
          <p className="text-end">{deadlineLabel(goal, lang, t) ?? t("بدون مهلت", "No deadline")}</p>
        </div>
        {goal.items.length > 0 && (
          <div className="mt-3 flex h-2 gap-1" aria-label={t("نمودار پیشرفت آیتم‌ها", "Item progress chart")}>
            {progress.items.map((item, index) => (
              <span key={goal.items[index]?.id} className="h-full flex-1 overflow-hidden rounded-full bg-secondary">
                <span className="block h-full bg-primary" style={{ width: `${item.percent}%` }} />
              </span>
            ))}
          </div>
        )}
      </Card>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">{t("آیتم‌های هدف", "Goal items")}</h2>
          <Button variant="secondary" onClick={() => setFlow("choose")}>
            <Plus className="h-4 w-4" />
            {t("افزودن به هدف", "Add to goal")}
          </Button>
        </div>
        {goal.items.length === 0 ? (
          <Card>
            <EmptyState
              emoji="🧩"
              text={t("اولین قدم هدف را اضافه کن.", "Add the first step for this goal.")}
            />
          </Card>
        ) : (
          <AnimatedCompletionList
            items={goal.items}
            isCompleted={(item) =>
              (progress.items[goal.items.findIndex((candidate) => candidate.id === item.id)]
                ?.percent ?? 0) >= 100
            }
            className="flex flex-col gap-2"
            renderItem={(item, onCompletionChange) => (
              <GoalItemRow
                item={item}
                itemProgress={
                  progress.items[goal.items.findIndex((candidate) => candidate.id === item.id)]
                }
                db={db}
                lang={lang}
                t={t}
                cal={cal}
                update={updateWithReopening}
                goalId={goalId}
                onCompletionChange={onCompletionChange}
                onEdit={() => {
                  setEditingItem(item);
                  setCustomNote(item.kind === "custom" ? (item.note ?? "") : "");
                  if (item.kind === "custom") {
                    setCustomTitle(item.title);
                    setCustomMeasure(item.measure);
                    setCustomTarget(
                      item.measure === "binary"
                        ? 1
                        : item.measure === "count"
                          ? item.target
                          : item.targetMinutes,
                    );
                    setCustomUnit(item.measure === "count" ? (item.unit ?? "") : "");
                  } else {
                    setTarget(item.target);
                  }
                }}
                onRemove={() => {
                  setConfirmation({
                    message: t(
                      "مطمئنی می‌خواهی این آیتم را از هدف حذف کنی؟",
                      "Remove this item from the goal?",
                    ),
                    action: () =>
                      patchGoal((current) => ({
                        ...current,
                        items: current.items.filter((candidate) => candidate.id !== item.id),
                      })),
                  });
                }}
              />
            )}
          />
        )}
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setConfirmation({
              message:
                goal.status === "completed"
                  ? t("هدف دوباره فعال شود؟", "Reopen this goal?")
                  : t(
                      "مطمئنی می‌خواهی این هدف را تمام کنی؟",
                      "Are you sure you want to complete this goal?",
                    ),
              action: () => {
                const completing = goal.status !== "completed";
                const accepted = patchGoal((current) => ({
                  ...current,
                  status: current.status === "completed" ? "active" : "completed",
                  completedAt: current.status === "completed" ? null : Date.now(),
                }));
                if (accepted && completing) {
                  if (progress.complete) queueGoalCompletionCelebration(goal);
                  onCompleted?.();
                }
                return accepted;
              },
            });
          }}
        >
          <Check className="h-4 w-4" />
          {goal.status === "completed"
            ? t("بازکردن دوباره", "Reopen")
            : t("اتمام هدف", "Complete goal")}
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            setConfirmation({
              message: t(
                "مطمئنی می‌خواهی این هدف را حذف کنی؟",
                "Are you sure you want to delete this goal?",
              ),
              action: () => {
                const accepted = update((current) => ({
                  ...current,
                  goals: current.goals.filter((item) => item.id !== goal.id),
                }));
                if (accepted) {
                  try {
                    localStorage.removeItem(`routino:goal-milestones:${goal.id}`);
                    localStorage.removeItem(`routino:goal-last-progress:${goal.id}`);
                  } catch {
                    // Optional local celebration state must not block deletion.
                  }
                  onDeleted?.();
                }
                return accepted;
              },
            });
          }}
        >
          <Trash2 className="h-4 w-4" />
          {t("حذف هدف", "Delete goal")}
        </Button>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t("ویرایش هدف", "Edit goal")}
      >
        <div className="flex flex-col gap-3">
          <Input
            aria-label={t("عنوان هدف", "Goal title")}
            value={editTitle}
            onInput={(event) => setEditTitle(event.currentTarget.value)}
            maxLength={256}
          />
          <textarea
            value={editDescription}
            onChange={(event) => setEditDescription(event.target.value)}
            maxLength={4000}
            placeholder={t("توضیح کوتاه (اختیاری)", "Short description (optional)")}
            className="min-h-20 w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
          />
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              {t("دسته‌بندی", "Category")}
            </p>
            <div className="flex flex-wrap gap-1">
              {db.categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() =>
                    setEditCategoryId(editCategoryId === category.id ? null : category.id)
                  }
                  className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${editCategoryId === category.id ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"}`}
                >
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-md text-white"
                    style={{ backgroundColor: category.color }}
                  >
                    <CatIcon icon={category.icon} className="h-3 w-3" />
                  </span>
                  {lang === "fa" ? category.nameFa : category.nameEn}
                </button>
              ))}
            </div>
          </div>
          <GoalDateField
            label={t("یادآوری", "Reminder")}
            value={editReminderOn ? editReminderDate + "T" + editReminderTime : null}
            onChange={(value) => {
              const parts = splitLocalDateTime(value, "09:00");
              setEditReminderOn(parts.on);
              setEditReminderDate(parts.date);
              setEditReminderTime(parts.time);
            }}
            cal={cal}
            lang={lang}
            t={t}
          />
          <GoalDateField
            label={t("ددلاین", "Deadline")}
            value={editDeadlineOn ? editDeadlineDate + "T" + editDeadlineTime : null}
            defaultTime="18:00"
            onChange={(value) => {
              const parts = splitLocalDateTime(value, "18:00");
              setEditDeadlineOn(parts.on);
              setEditDeadlineDate(parts.date);
              setEditDeadlineTime(parts.time);
            }}
            cal={cal}
            lang={lang}
            t={t}
          />
          <div className="grid grid-cols-4 gap-1">
            {GOAL_PRIORITIES.map((priority) => (
              <button
                key={priority}
                type="button"
                onClick={() => setEditPriority(priority)}
                className={`rounded-xl border px-3 py-2 text-xs font-bold ${editPriority === priority ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"}`}
              >
                {priorityLabel(priority, t)}
              </button>
            ))}
          </div>
          <Button
            disabled={!editTitle.trim()}
            onClick={() => {
              patchGoal((current) => ({
                ...current,
                title: editTitle.trim(),
                description: editDescription.trim() || undefined,
                categoryId: editCategoryId,
                reminderAt: editReminderOn ? `${editReminderDate}T${editReminderTime}` : null,
                deadlineAt: editDeadlineOn ? `${editDeadlineDate}T${editDeadlineTime}` : null,
                priority: editPriority,
              }));
              if (editReminderOn && !db.settings.notificationsEnabled)
                toast.warning(
                  t(
                    "هدف ذخیره شد؛ برای دریافت یادآوری، اعلان‌ها را از تنظیمات فعال کن.",
                    "Goal saved; enable notifications in Settings to receive its reminder.",
                  ),
                );
              setEditOpen(false);
            }}
          >
            {t("ذخیره تغییرات", "Save changes")}
          </Button>
        </div>
      </Modal>
      <GoalCelebration milestone={milestone} title={goal.title} onClose={() => setMilestone(null)} t={t} lang={lang} />

      <Modal
        open={flow === "choose"}
        onClose={() => setFlow("idle")}
        title={t("افزودن به هدف", "Add to goal")}
      >
        <div className="grid gap-2">
          <Button variant="outline" onClick={() => setFlow("habit")}>
            {t("اتصال عادت", "Connect habit")}
          </Button>
          <Button variant="outline" onClick={() => setFlow("task")}>
            {t("اتصال کار", "Connect task")}
          </Button>
          <Button variant="outline" onClick={() => setFlow("custom")}>
            {t("آیتم مستقل", "Standalone item")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={flow === "habit"}
        onClose={() => setFlow("idle")}
        title={t("انتخاب عادت", "Choose habit")}
      >
        <div className="flex flex-col gap-2">
          {db.habits
            .filter((habit) => !habit.archived && !goalHasSource(goal, "habit", habit.id))
            .map((habit) => (
              <Button
                key={habit.id}
                variant="outline"
                onClick={() => selectSource("habit", habit.id)}
              >
                {habit.name}
              </Button>
            ))}
          <Button
            onClick={() => {
              setHabitDraft(emptyDraft(db.categories[0]?.id ?? "default"));
              setFlow("new-habit");
            }}
          >
            <Plus className="h-4 w-4" />
            {t("ساخت عادت جدید", "Create new habit")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={flow === "task"}
        onClose={() => setFlow("idle")}
        title={t("انتخاب کار", "Choose task")}
      >
        <div className="flex flex-col gap-2">
          {db.tasks
            .filter((task) => !goalHasSource(goal, "task", task.id))
            .map((task) => (
              <Button key={task.id} variant="outline" onClick={() => selectSource("task", task.id)}>
                {task.title}
              </Button>
            ))}
          <Button
            onClick={() => {
              setTaskDraft(emptyTaskDraft(todayKey()));
              setFlow("new-task");
            }}
          >
            <Plus className="h-4 w-4" />
            {t("ساخت کار جدید", "Create new task")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={flow === "target"}
        onClose={() => setFlow("idle")}
        title={t("هدف این آیتم", "Item target")}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm font-bold text-foreground">
            {source &&
              (source.type === "habit"
                ? db.habits.find((item) => item.id === source.id)?.name
                : db.tasks.find((item) => item.id === source.id)?.title)}
          </p>
          {sourceEntity &&
            !(source?.type === "task" && measureOfSource(sourceEntity) === "binary") &&
            (measureOfSource(sourceEntity) === "time" ? (
              <LongDurationInput minutes={target} onChange={setTarget} t={t} />
            ) : (
              <Input
                aria-label={t("هدف این آیتم", "Item target")}
                type="number"
                min="1"
                value={target}
                onInput={(event) => setTarget(Number(event.currentTarget.value) || 0)}
              />
            ))}
          <Button disabled={!source || target <= 0} onClick={connectSource}>
            {t("اتصال به هدف", "Connect to goal")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={flow === "custom"}
        onClose={() => setFlow("idle")}
        title={t("آیتم مستقل", "Standalone item")}
      >
        <div className="flex flex-col gap-3">
          <Input
            value={customTitle}
            onInput={(event) => setCustomTitle(event.currentTarget.value)}
            maxLength={256}
            placeholder={t("مثلاً: ثبت‌نام باشگاه", "e.g. Register at the gym")}
          />
          <div className="grid grid-cols-3 gap-2">
            {(["binary", "count", "time"] as const).map((measure) => (
              <button
                key={measure}
                type="button"
                onClick={() => {
                  setCustomMeasure(measure);
                  setCustomTarget(measure === "time" ? 25 : 1);
                }}
                className={`rounded-xl border px-2 py-2 text-xs font-bold ${customMeasure === measure ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"}`}
              >
                {measure === "binary"
                  ? t("انجام‌شدنی", "Done")
                  : measure === "count"
                    ? t("تعدادی", "Count")
                    : t("زمانی", "Time")}
              </button>
            ))}
          </div>
          {customMeasure === "count" && (
            <Input
              aria-label={t("مقدار هدف", "Target amount")}
              type="number"
              min="1"
              value={customTarget}
              onInput={(event) => setCustomTarget(Number(event.currentTarget.value) || 0)}
            />
          )}
          {customMeasure === "time" && (
            <LongDurationInput minutes={customTarget} onChange={setCustomTarget} t={t} />
          )}
          {customMeasure === "count" && (
            <Input
              value={customUnit}
              onInput={(event) => setCustomUnit(event.currentTarget.value)}
              maxLength={64}
              placeholder={t("واحد (اختیاری)", "Unit (optional)")}
            />
          )}
          <Button disabled={!customTitle.trim() || customTarget <= 0} onClick={addCustom}>
            {t("افزودن آیتم", "Add item")}
          </Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(confirmation)}
        onClose={() => setConfirmation(null)}
        title={t("تأیید", "Confirm")}
      >
        <p className="mb-4 text-sm leading-7 text-foreground">{confirmation?.message}</p>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => {
              if (confirmation?.action()) setConfirmation(null);
            }}
          >
            {t("تأیید", "Confirm")}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmation(null)}>
            {t("انصراف", "Cancel")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={Boolean(editingItem)}
        onClose={() => setEditingItem(null)}
        title={t("ویرایش آیتم", "Edit item")}
      >
        {editingItem && (
          <div className="flex flex-col gap-3">
            {editingItem.kind === "custom" ? (
              <>
                <Input
                  aria-label={t("توضیحات آیتم", "Item notes")}
                  value={customNote}
                  maxLength={4000}
                  onInput={(event) => setCustomNote(event.currentTarget.value)}
                  placeholder={t("توضیحات (اختیاری)", "Notes (optional)")}
                />
                <Input
                  value={customTitle}
                  onChange={(event) => setCustomTitle(event.target.value)}
                  maxLength={256}
                  aria-label={t("عنوان آیتم", "Item title")}
                />
                <div className="grid grid-cols-3 gap-2">
                  {(["binary", "count", "time"] as const).map((measure) => (
                    <button
                      key={measure}
                      type="button"
                      onClick={() => {
                        setCustomMeasure(measure);
                        setCustomTarget(measure === "time" ? 25 : 1);
                      }}
                      className={`rounded-xl border px-2 py-2 text-xs font-bold ${customMeasure === measure ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"}`}
                    >
                      {measure === "binary"
                        ? t("انجام‌شدنی", "Done")
                        : measure === "count"
                          ? t("تعدادی", "Count")
                          : t("زمانی", "Time")}
                    </button>
                  ))}
                </div>
                {customMeasure === "count" && (
                  <>
                    <Input
                      aria-label={t("مقدار هدف", "Target amount")}
                      type="number"
                      min={1}
                      value={customTarget}
                      onInput={(event) => setCustomTarget(Number(event.currentTarget.value) || 0)}
                    />
                    <Input
                      value={customUnit}
                      onInput={(event) => setCustomUnit(event.currentTarget.value)}
                      placeholder={t("واحد (اختیاری)", "Unit (optional)")}
                    />
                  </>
                )}
                {customMeasure === "time" && (
                  <LongDurationInput minutes={customTarget} onChange={setCustomTarget} t={t} />
                )}
              </>
            ) : editingItem.measure === "binary" && editingItem.sourceType === "task" ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "این کار انجام‌شدنی است و هدف عددی ندارد.",
                  "This binary task has no numeric target.",
                )}
              </p>
            ) : editingItem.measure === "time" ? (
              <LongDurationInput minutes={target} onChange={setTarget} t={t} />
            ) : (
              <Input
                aria-label={t("هدف این آیتم", "Item target")}
                type="number"
                min={1}
                value={target}
                onChange={(event) => setTarget(Number(event.target.value) || 0)}
              />
            )}
            <Button
              disabled={
                editingItem.kind === "custom"
                  ? !customTitle.trim() || (customMeasure !== "binary" && customTarget <= 0)
                  : target <= 0
              }
              onClick={() => {
                patchGoal((current) => ({
                  ...current,
                  items: current.items.map((candidate) => {
                    if (candidate.id !== editingItem.id) return candidate;
                    if (candidate.kind === "source")
                      return {
                        ...candidate,
                        target:
                          candidate.measure === "binary" && candidate.sourceType === "task"
                            ? 1
                            : target,
                      };
                    return {
                      ...reconfigureCustomGoalItem(
                        candidate,
                        customMeasure === "binary"
                          ? { title: customTitle, measure: "binary" }
                          : customMeasure === "count"
                            ? {
                                title: customTitle,
                                measure: "count",
                                target: customTarget,
                                unit: customUnit.trim() || undefined,
                              }
                            : { title: customTitle, measure: "time", targetMinutes: customTarget },
                      ),
                      note: customNote.trim() || undefined,
                    };
                  }),
                }));
                setEditingItem(null);
              }}
            >
              {t("ذخیره تغییرات", "Save changes")}
            </Button>
          </div>
        )}
      </Modal>

      <HabitFormModal
        open={flow === "new-habit"}
        onClose={() => setFlow("habit")}
        draft={habitDraft}
        setDraft={setHabitDraft}
        categories={db.categories}
        onSave={saveNewHabit}
        t={t}
        lang={lang}
      />
      <TaskFormModal
        open={flow === "new-task"}
        onClose={() => setFlow("task")}
        draft={taskDraft}
        setDraft={setTaskDraft}
        onSave={saveNewTask}
        cal={cal}
        lang={lang}
        t={t}
        categories={db.categories}
      />
    </div>
  );
}
