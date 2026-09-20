import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Check, Plus } from "lucide-react";
import { useState } from "react";
import { AnimatedCompletionList } from "@/components/AnimatedCompletionList";
import { AppShell } from "@/components/AppShell";
import {
  draftToTask,
  enableTaskReminderNotifications,
  emptyTaskDraft,
  type TaskDraft,
  TaskFormModal,
  TaskRow,
  taskToDraft,
} from "@/components/tasks";
import { Chip, DatePickerCalendar, EmptyState } from "@/components/ui";
import { WeekStrip } from "@/components/WeekStrip";
import { addDays, faNum, formatDate, todayKey } from "@/lib/dates";
import { useAppMaybe } from "@/state/app";
import { triggerCompletionFeedback } from "@/lib/completion-feedback";

export const Route = createFileRoute("/tasks")({
  component: () => (
    <AppShell>
      <TasksPage />
    </AppShell>
  ),
});

function TasksPage() {
  const ctx = useAppMaybe();
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<TaskDraft>(() => emptyTaskDraft(todayKey()));

  if (!ctx?.db) return null;
  const { db, update, reorderLocal, updatePreferences, t, lang, cal } = ctx;

  const todayK = todayKey();
  const tomorrowK = addDays(todayK, 1);
  const isCustomDay = selectedDay !== todayK && selectedDay !== tomorrowK;
  const dayTasks = db.tasks.filter((task) => task.dateKey === selectedDay);
  const doneCount = dayTasks.filter((task) => task.done).length;
  const taskCount = (dateKey: string) =>
    db.tasks.filter((task) => task.dateKey === dateKey && !task.done).length;
  const taskPercent = (dateKey: string) => {
    const tasks = db.tasks.filter((task) => task.dateKey === dateKey);
    if (tasks.length === 0) return null;
    return Math.round((tasks.filter((task) => task.done).length / tasks.length) * 100);
  };

  const openNewTask = () => {
    setDraft(emptyTaskDraft(selectedDay));
    setFormOpen(true);
  };

  const openTaskEdit = (task: (typeof db.tasks)[number]) => {
    setDraft(taskToDraft(task));
    setFormOpen(true);
  };

  const saveTask = () => {
    if (!draft.title.trim()) return;
    const existing = draft.id ? db.tasks.find((task) => task.id === draft.id) : undefined;
    const nextTask = draftToTask(draft, existing);
    const accepted = update((current) => ({
      ...current,
      tasks: existing
        ? current.tasks.map((task) => (task.id === nextTask.id ? nextTask : task))
        : [...current.tasks, nextTask],
    }));
    if (!accepted) return;
    if (nextTask.reminderAt && !db.settings.notificationsEnabled) {
      enableTaskReminderNotifications({ updatePreferences, t });
    }
    setSelectedDay(nextTask.dateKey);
    setFormOpen(false);
  };

  return (
    <div className="page-stagger flex flex-col gap-5">
      <WeekStrip
        selected={selectedDay}
        onSelect={setSelectedDay}
        cal={cal}
        lang={lang}
        countFor={taskCount}
        percentFor={taskPercent}
      />

      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            active={selectedDay === todayK}
            onClick={() => {
              setSelectedDay(todayK);
              setDatePickerOpen(false);
            }}
          >
            {t("امروز", "Today")}
          </Chip>
          <Chip
            active={selectedDay === tomorrowK}
            onClick={() => {
              setSelectedDay(tomorrowK);
              setDatePickerOpen(false);
            }}
          >
            {t("فردا", "Tomorrow")}
          </Chip>
          <Chip active={isCustomDay} onClick={() => setDatePickerOpen((value) => !value)}>
            <CalendarDays className="h-3 w-3" />
            {t("دلخواه", "Pick a date")}
          </Chip>
          <span className="ms-auto text-xs text-muted-foreground">
            {formatDate(selectedDay, cal, lang)}
          </span>
        </div>
        {datePickerOpen && (
          <div className="mt-2">
            <DatePickerCalendar
              value={selectedDay}
              onChange={(dateKey) => {
                setSelectedDay(dateKey);
                setDatePickerOpen(false);
              }}
              cal={cal}
              lang={lang}
            />
          </div>
        )}
      </div>

      <div className="card-surface overflow-hidden !p-0">
        <div className="flex items-center gap-2 p-4 pb-0">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-success/20 text-success">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
          <span className="text-sm font-bold text-foreground">
            {t("کارهای این روز", "This day's To-dos")}
            <span className="ms-1.5 text-xs font-normal text-muted-foreground">
              {faNum(doneCount, lang)}/{faNum(dayTasks.length, lang)}
            </span>
          </span>
        </div>

        <div className="flex flex-col gap-2 p-4 pt-3">
          <button
            type="button"
            onClick={openNewTask}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-sm font-bold text-primary transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Plus className="h-4 w-4" />
            {t("افزودن کار", "Add task")}
          </button>

          {dayTasks.length === 0 ? (
            <EmptyState
              emoji="📋"
              text={t("برای این روز کاری ثبت نشده.", "No tasks for this day.")}
            />
          ) : (
            <AnimatedCompletionList
              key={selectedDay}
              items={dayTasks}
              isCompleted={(task) => task.done}
              onReorder={(ids) => reorderLocal("tasks", ids)}
              onReorderStart={() =>
                triggerCompletionFeedback({
                  completionSoundEnabled: false,
                  hapticsEnabled: db.settings.hapticsEnabled,
                })
              }
              className="flex flex-col gap-2"
              renderItem={(task, onCompletionChange) => (
                <TaskRow
                  task={task}
                  settings={db.settings}
                  lang={lang}
                  t={t}
                  onUpdate={(patch) =>
                    update((current) => ({
                      ...current,
                      tasks: current.tasks.map((item) =>
                        item.id === task.id ? { ...item, ...patch } : item,
                      ),
                    }))
                  }
                  onDelete={() =>
                    update((current) => ({
                      ...current,
                      tasks: current.tasks.filter((item) => item.id !== task.id),
                    }))
                  }
                  onEdit={() => openTaskEdit(task)}
                  onCompletionChange={onCompletionChange}
                />
              )}
            />
          )}
        </div>
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        {t("کارها در آنالیز کلی محاسبه نمی‌شوند.", "Tasks are not counted in overall analytics.")}
      </p>

      <TaskFormModal
        open={formOpen}
        draft={draft}
        setDraft={setDraft}
        onClose={() => setFormOpen(false)}
        onSave={saveTask}
        cal={cal}
        lang={lang}
        t={t}
      />
    </div>
  );
}
