import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Check, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { addQuickTask, TaskRow } from "@/components/tasks";
import {
  Button,
  CatIcon,
  CATEGORY_ICONS,
  Chip,
  DatePickerCalendar,
  EmptyState,
  Input,
  Modal,
  TimePicker24,
} from "@/components/ui";
import { WeekStrip } from "@/components/WeekStrip";
import { addDays, faNum, formatDate, todayKey } from "@/lib/dates";
import { scheduleTaskReminder } from "@/lib/native-notifications";
import { CATEGORY_COLOR_CHOICES } from "@/lib/presets";
import { uid } from "@/lib/store";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/tasks")({
  component: () => (
    <AppShell>
      <TasksPage />
    </AppShell>
  ),
});

const TASK_DEFAULT_COLOR = CATEGORY_COLOR_CHOICES[0];
const TASK_DEFAULT_ICON = "star";

function TasksPage() {
  const ctx = useAppMaybe();
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formDateOpen, setFormDateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderTime, setReminderTime] = useState("09:00");
  const [color, setColor] = useState(TASK_DEFAULT_COLOR);
  const [icon, setIcon] = useState(TASK_DEFAULT_ICON);

  if (!ctx?.db) return null;
  const { db, update, t, lang, cal } = ctx;

  const todayK = todayKey();
  const tomorrowK = addDays(todayK, 1);
  const isCustomDay = selectedDay !== todayK && selectedDay !== tomorrowK;

  const dayTasks = db.tasks.filter((task) => task.dateKey === selectedDay);
  const doneCount = dayTasks.filter((x) => x.done).length;
  const taskCount = (k: string) => db.tasks.filter((x) => x.dateKey === k && !x.done).length;
  const taskPercent = (k: string) => {
    const forDay = db.tasks.filter((x) => x.dateKey === k);
    if (forDay.length === 0) return null;
    const doneForDay = forDay.filter((x) => x.done).length;
    return Math.round((doneForDay / forDay.length) * 100);
  };

  const submitQuick = () => {
    if (!quickTitle.trim()) return;
    update((d) => addQuickTask(d, selectedDay, quickTitle).db);
    setQuickTitle("");
  };

  const addAdvancedTask = () => {
    if (!title.trim()) return;
    const newId = uid();
    const trimmedTitle = title.trim();
    // یادآوری برای همان روزِ کار، در ساعت انتخاب‌شده.
    const reminderAt = reminderOn ? `${selectedDay}T${reminderTime}` : null;
    update((d) => ({
      ...d,
      tasks: [
        ...d.tasks,
        {
          id: newId,
          dateKey: selectedDay,
          title: trimmedTitle,
          type: "binary",
          target: 1,
          value: 0,
          done: false,
          note: note.trim() || undefined,
          reminderAt,
          color,
          icon,
        },
      ],
    }));
    // schedule a native OS-level alarm too (no-op on web)
    if (reminderAt) void scheduleTaskReminder(newId, trimmedTitle, reminderAt);
    setTitle("");
    setNote("");
    setReminderOn(false);
    setReminderTime("09:00");
    setColor(TASK_DEFAULT_COLOR);
    setIcon(TASK_DEFAULT_ICON);
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

      {/* which day new tasks land on — also drives the list/strip above, so the
          task appears where it was scheduled and nowhere else */}
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
          <Chip active={isCustomDay} onClick={() => setDatePickerOpen((v) => !v)}>
            <CalendarDays className="h-3 w-3" />
            {t("دلخواه", "Pick a date")}
          </Chip>
          <span className="ms-auto text-xs text-muted-foreground">{formatDate(selectedDay, cal, lang)}</span>
        </div>
        {datePickerOpen && (
          <div className="mt-2">
            <DatePickerCalendar
              value={selectedDay}
              onChange={(dk) => {
                setSelectedDay(dk);
                setDatePickerOpen(false);
              }}
              cal={cal}
              lang={lang}
            />
          </div>
        )}
      </div>

      {/* quick add + today's todos, collapsible */}
      <div className="card-surface overflow-hidden !p-0">
        <div className="flex items-center justify-between p-4 pb-0">
          <div className="flex items-center gap-2">
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
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-primary hover:bg-secondary"
          >
            <Settings2 className="h-3 w-3" /> {t("پیشرفته", "Advanced")}
          </button>
        </div>

        <div className="flex flex-col gap-2 p-4 pt-3">
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

          {dayTasks.length === 0 ? (
            <EmptyState emoji="📋" text={t("برای این روز کاری ثبت نشده.", "No tasks for this day.")} />
          ) : (
            dayTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                lang={lang}
                t={t}
                onUpdate={(patch) =>
                  update((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === task.id ? { ...x, ...patch } : x)) }))
                }
                onDelete={() => update((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== task.id) }))}
              />
            ))
          )}
        </div>
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        {t("کارها در آنالیز کلی محاسبه نمی‌شوند.", "Tasks are not counted in overall analytics.")}
      </p>

      {/* advanced task creation: icon, color, quantity/time goal, reminder */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={t("کار جدید (پیشرفته)", "New task (advanced)")}>
        <div className="flex flex-col gap-3">
          {/* تاریخ کار: با زدن روی آن، تقویم باز می‌شود و روز دلخواه انتخاب می‌شود. */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("تاریخ کار", "Task date")}</p>
            <button
              type="button"
              onClick={() => setFormDateOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-sm font-bold text-foreground hover:bg-secondary"
            >
              <span>{formatDate(selectedDay, cal, lang)}</span>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </button>
            {formDateOpen && (
              <div className="mt-2">
                <DatePickerCalendar
                  value={selectedDay}
                  onChange={(dk) => {
                    setSelectedDay(dk);
                    setFormDateOpen(false);
                  }}
                  cal={cal}
                  lang={lang}
                />
              </div>
            )}
          </div>

          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("عنوان کار", "Task title")} />

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("آیکون", "Icon")}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(CATEGORY_ICONS).map((iconKey) => (
                <button
                  key={iconKey}
                  onClick={() => setIcon(iconKey)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
                    icon === iconKey ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
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
              {CATEGORY_COLOR_CHOICES.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full transition-transform ${
                    color === c ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-card" : ""
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("یادداشت (اختیاری)", "Note (optional)")} />

          {/* یادآوری: کلید روشن/خاموش؛ وقتی روشن است، انتخاب ساعت زیرش می‌آید. */}
          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {t("یادآوری در همین روز", "Reminder on this day")}
              </p>
              <button
                type="button"
                onClick={() => setReminderOn((v) => !v)}
                className={`relative h-6 w-11 rounded-full transition-colors ${reminderOn ? "bg-primary" : "bg-secondary"}`}
                aria-label={t("یادآوری", "Reminder")}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    reminderOn ? "start-5.5" : "start-0.5"
                  }`}
                />
              </button>
            </div>
            {reminderOn && (
              <div className="mt-2 rounded-2xl border border-border p-3">
                <TimePicker24 value={reminderTime} onChange={setReminderTime} lang={lang} t={t} />
                <p className="mt-1 text-center text-[10px] text-muted-foreground">
                  {t(
                    `یادآوری در ${formatDate(selectedDay, cal, lang)} ساعت ${reminderTime}`,
                    `Reminder on ${formatDate(selectedDay, cal, lang)} at ${reminderTime}`,
                  )}
                </p>
              </div>
            )}
          </div>
          <Button onClick={addAdvancedTask} disabled={!title.trim()}>
            <Plus className="h-4 w-4" /> {t("افزودن کار", "Add task")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
