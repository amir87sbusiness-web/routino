/** Habit form modal, daily log row, milestone celebration logic. */
import { Check, Minus, Pencil, Plus, SmilePlus, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, CatIcon, Chip, DurationPicker, formatDuration, Input, Modal, Progress, TimePicker24 } from "@/components/ui";
import {
  addDays,
  dayOfMonth,
  faNum,
  keyToDate,
  monthDays,
  todayKey,
  weekdayOrder,
  weekdayShort,
  WEEKDAYS_EN,
  WEEKDAYS_FA,
  type Calendar,
  type Lang,
} from "@/lib/dates";
import { cappedPercent, getLog, isCompleted, isDueOn, monthProgress, rawPercent } from "@/lib/logic";
import { MOOD_EMOJIS } from "@/lib/presets";
import { logKey, uid, type Category, type Db, type Habit, type ScheduleKind, type UnitKind } from "@/lib/store";

/* ---------------- celebration ---------------- */

export interface Celebration {
  habitName: string;
  milestone: 70 | 100;
}

/** Surfaces a milestone popup once per crossing.
 *
 * `applyLog` already records every milestone it fires in `meta.celebrated` (as
 * its dedup key), so that array is the source of truth. Reading it here — rather
 * than returning the celebration out of `applyLog` — is what lets call sites run
 * `applyLog` inside the `update()` updater, where it always sees fresh state.
 * A value cannot be smuggled out of an updater: React invokes it during render,
 * not at call time. */
export function useCelebration(db: Db | null | undefined): { celebration: Celebration | null; clear: () => void } {
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const celebrated = db?.meta.celebrated;
  const habits = db?.habits;

  useEffect(() => {
    if (!celebrated || !habits) return;
    // First pass adopts the existing keys, so past milestones don't replay on mount.
    if (seen.current === null) {
      seen.current = new Set(celebrated);
      return;
    }
    for (const key of celebrated) {
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      const [habitId, , milestone] = key.split("|");
      const habit = habits.find((h) => h.id === habitId);
      if (habit) setCelebration({ habitName: habit.name, milestone: Number(milestone) as 70 | 100 });
    }
  }, [celebrated, habits]);

  return { celebration, clear: () => setCelebration(null) };
}

/** Apply a log patch; returns next db + celebration if a milestone was crossed.
 * Must be called INSIDE an `update()` updater so it reads fresh state — the
 * returned `celebration` is for that updater's own bookkeeping; UI should read
 * it via `useCelebration`. */
export function applyLog(
  db: Db,
  habit: Habit,
  cal: Calendar,
  patch: Partial<{ value: number; done: boolean; note: string; mood: string }>,
  dk = todayKey(),
): { db: Db; celebration: Celebration | null } {
  const key = logKey(habit.id, dk);
  const prev = db.logs[key] ?? { habitId: habit.id, dateKey: dk, value: 0, done: false };
  const nextLog = { ...prev, ...patch };
  let next: Db = { ...db, logs: { ...db.logs, [key]: nextLog } };

  const before = monthProgress(db, habit, cal, dk).percent;
  const after = monthProgress(next, habit, cal, dk).percent;
  const monthId = monthDays(dk, cal)[0];
  let celebration: Celebration | null = null;

  // Badges themselves are derived from the logs by earnedBadges(); this loop
  // only fires the one-time celebration popup for crossing a milestone.
  for (const m of [70, 100] as const) {
    const cKey = `${habit.id}|${monthId}|${m}`;
    if (after >= m && before < m && !next.meta.celebrated.includes(cKey)) {
      celebration = { habitName: habit.name, milestone: m };
      next = { ...next, meta: { ...next.meta, celebrated: [...next.meta.celebrated, cKey] } };
    }
  }
  return { db: next, celebration };
}

export function CelebrationModal({
  celebration,
  onClose,
  t,
  lang,
}: {
  celebration: Celebration | null;
  onClose: () => void;
  t: (fa: string, en: string) => string;
  lang: Lang;
}) {
  return (
    <Modal open={!!celebration} onClose={onClose}>
      {celebration && (
        <div className="flex flex-col items-center gap-3 pb-2 text-center">
          <span className="text-6xl">{celebration.milestone === 100 ? "🏆" : "🎉"}</span>
          <h3 className="text-lg font-black text-foreground">
            {celebration.milestone === 100
              ? t("هدف ماهانه کامل شد!", "Monthly goal complete!")
              : t("عالیه! ۷۰٪ راه رو رفتی!", "Awesome! You're 70% there!")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {celebration.habitName} —{" "}
            {celebration.milestone === 100
              ? t("یه نشان جدید گرفتی 🏅", "You earned a new badge 🏅")
              : t(`${faNum(70, lang)}٪ از هدف ماهانه`, `${faNum(70, lang)}% of the monthly goal`)}
          </p>
          <Button onClick={onClose}>{t("ادامه بده! 💪", "Keep going! 💪")}</Button>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- habit row (daily logging) ---------------- */

export function HabitRow({
  db,
  habit,
  cal,
  lang,
  t,
  dk,
  onUpdate,
}: {
  db: Db;
  habit: Habit;
  cal: Calendar;
  lang: Lang;
  t: (fa: string, en: string) => string;
  dk: string;
  onUpdate: (fn: (db: Db) => Db) => void;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [noteVal, setNoteVal] = useState("");
  const [amountVal, setAmountVal] = useState("");
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [rowFlash, setRowFlash] = useState(false);
  const dragStartX = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const log = getLog(db, habit.id, dk);
  const cat = db.categories.find((c) => c.id === habit.categoryId);
  const done = isCompleted(habit, log);
  const raw = rawPercent(habit, log);
  const isFuture = dk > todayKey();

  const commit = (patch: Partial<{ value: number; done: boolean; note: string; mood: string }>) => {
    if (isFuture) return;
    onUpdate((d) => applyLog(d, habit, cal, patch, dk).db);
  };

  const toggleDone = (next: boolean) => {
    if (isFuture) return;
    if (habit.type === "binary") commit({ done: next, value: next ? 1 : 0 });
    else commit(next ? { value: habit.target, done: true } : { value: 0, done: false });
    setRowFlash(true);
    setTimeout(() => setRowFlash(false), 300);
    if (next) {
      setJustCompleted(true);
      setTimeout(() => setJustCompleted(false), 350);
    }
  };

  const SWIPE_THRESHOLD = 76;

  const onPointerDown = (e: ReactPointerEvent) => {
    if (detailOpen || isFuture) return;
    dragStartX.current = e.clientX;
    pointerId.current = e.pointerId;
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (dragStartX.current === null || pointerId.current !== e.pointerId) return;
    const delta = e.clientX - dragStartX.current;
    setDragX(Math.max(-120, Math.min(120, delta)));
  };
  const endDrag = () => {
    if (dragStartX.current === null) return;
    if (dragX > SWIPE_THRESHOLD && !done) toggleDone(true);
    else if (dragX < -SWIPE_THRESHOLD && done) toggleDone(false);
    dragStartX.current = null;
    pointerId.current = null;
    setDragging(false);
    setDragX(0);
  };

  const openDetail = () => {
    setNoteVal(log?.note ?? "");
    setAmountVal(log ? String(log.value || "") : "");
    setDetailOpen(true);
  };

  const tint = cat?.color ?? "#F97316";
  return (
    <>
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
          backgroundColor: done ? `${tint}22` : undefined,
          borderColor: done ? `${tint}55` : undefined,
          transform: `translateX(${dragX}px)`,
        }}
      >
      <div className="flex items-center gap-3">
        {/* complete toggle */}
        <button
          onClick={() => toggleDone(!done)}
          disabled={isFuture}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${
            done ? "border-transparent text-white" : "border-border text-transparent hover:border-primary"
          }`}
          style={done ? { backgroundColor: tint } : undefined}
        >
          <Check className={`h-5 w-5 ${justCompleted ? "animate-check-pop" : ""}`} strokeWidth={3} />
        </button>

        <button className="min-w-0 flex-1 text-start" onClick={openDetail}>
          <div className="flex items-center gap-1.5">
            <span
              className="flex h-4.5 w-4.5 items-center justify-center rounded-md text-white"
              style={{ backgroundColor: tint }}
            >
              <CatIcon icon={cat?.icon ?? "star"} className="h-2.5 w-2.5" />
            </span>
            <p className="truncate text-sm font-bold text-foreground">
              {habit.name}
            </p>
          </div>
          <WeekChecks db={db} habit={habit} cal={cal} refDk={dk} tint={tint} />
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            {habit.type === "quantity" && (
              <span>
                {habit.unitKind === "time"
                  ? `${formatDuration(log?.value ?? 0, lang)} / ${formatDuration(habit.target, lang)}`
                  : `${faNum(log?.value ?? 0, lang)} / ${faNum(habit.target, lang)} ${habit.unit ?? ""}`}
              </span>
            )}
            {log?.mood && <span>{log.mood}</span>}
            {log?.note && <span className="truncate">📝 {log.note}</span>}
          </div>
        </button>

        {habit.type === "quantity" ? (
          <div className="flex items-center gap-1">
            <button
              disabled={isFuture}
              onClick={() => {
                const step = habit.unitKind === "time" ? 1 : 1;
                const v = Math.max(0, (log?.value ?? 0) - step);
                commit({ value: v, done: v >= habit.target });
              }}
              className="rounded-full border border-border p-1.5 text-muted-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              disabled={isFuture}
              onClick={() => {
                const step = habit.unitKind === "time" ? 1 : 1;
                const v = (log?.value ?? 0) + step;
                commit({ value: v, done: v >= habit.target });
              }}
              className="rounded-full border border-border p-1.5 text-muted-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button onClick={openDetail} className="rounded-full p-2 text-muted-foreground hover:bg-secondary">
            <SmilePlus className="h-4 w-4" />
          </button>
        )}
      </div>

      {habit.type === "quantity" && (
        <div className="mt-2.5 flex items-center gap-2">
          <Progress value={cappedPercent(habit, log)} color={cat?.color} className="flex-1" />
          <span className={`text-[10px] font-bold ${raw > 100 ? "text-success" : "text-muted-foreground"}`}>
            {faNum(raw, lang)}٪
          </span>
        </div>
      )}
      {raw > 100 && (
        <p className="mt-1 text-[10px] font-medium text-success">
          {t(
            `🔥 ${faNum(raw, lang)}٪ — ${faNum(raw - 100, lang)}٪ بیشتر از هدف انجام دادی!`,
            `🔥 ${raw}% — you did ${raw - 100}% more than your goal!`,
          )}
        </p>
      )}
      </div>
      </div>

      {/* detail modal: actual amount, note, mood */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={habit.name}>
        <div className="flex flex-col gap-4">
          {isFuture && (
            <p className="rounded-xl bg-secondary px-3 py-2 text-center text-[11px] font-medium text-muted-foreground">
              {t("این یه روز آینده‌ست — فقط می‌تونی نگاه کنی.", "This is a future day — view only.")}
            </p>
          )}
          {habit.type === "quantity" && (
            <div className={isFuture ? "pointer-events-none opacity-50" : undefined}>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                {habit.unitKind === "time"
                  ? t(`مقدار واقعی انجام‌شده (هدف: ${formatDuration(habit.target, lang)})`, `Actual amount (goal: ${formatDuration(habit.target, lang)})`)
                  : t(`مقدار واقعی انجام‌شده (هدف: ${faNum(habit.target, lang)} ${habit.unit ?? ""})`, `Actual amount (goal: ${habit.target} ${habit.unit ?? ""})`)}
              </p>
              {habit.unitKind === "time" ? (
                <DurationPicker
                  totalMinutes={Number(amountVal) || 0}
                  onChange={(m) => setAmountVal(String(m))}
                  lang={lang}
                  t={t}
                />
              ) : (
                <Input
                  type="number"
                  inputMode="decimal"
                  dir="ltr"
                  value={amountVal}
                  onChange={(e) => setAmountVal(e.target.value)}
                  placeholder="0"
                  className="text-center"
                />
              )}
            </div>
          )}
          <div className={isFuture ? "pointer-events-none opacity-50" : undefined}>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("احساست امروز", "Today's mood")}</p>
            <div className="flex flex-wrap gap-1.5">
              {MOOD_EMOJIS.map((m) => (
                <button
                  key={m}
                  onClick={() => commit({ mood: log?.mood === m ? "" : m })}
                  className={`rounded-xl border p-2 text-lg transition-all ${
                    log?.mood === m ? "border-primary bg-primary-soft" : "border-border"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className={isFuture ? "pointer-events-none opacity-50" : undefined}>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("یادداشت کوتاه", "Short note")}</p>
            <Input
              value={noteVal}
              onChange={(e) => setNoteVal(e.target.value)}
              placeholder={t("مثلاً: امروز سخت بود ولی انجامش دادم", "e.g. tough day but I did it")}
            />
          </div>
          {!isFuture && (
            <Button
              onClick={() => {
                const patch: Partial<{ value: number; done: boolean; note: string }> = { note: noteVal };
                if (habit.type === "quantity" && amountVal !== "") {
                  const v = Number(amountVal) || 0;
                  patch.value = v;
                  patch.done = v >= habit.target;
                }
                commit(patch);
                setDetailOpen(false);
              }}
            >
              {t("ثبت", "Save")}
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}

/** Minimal 7-dot trail of a habit's last week (ending at refDk): a filled dot in
 * the habit's own category color for a completed day, a hollow outline for a
 * missed one, and a tiny faint dot for days it wasn't due (or didn't exist yet)
 * so a brand-new habit doesn't look like it failed days it wasn't around for. */
function WeekChecks({
  db,
  habit,
  cal,
  refDk,
  tint,
}: {
  db: Db;
  habit: Habit;
  cal: Calendar;
  refDk: string;
  /** The habit's category color — completed days are filled with it. */
  tint: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(refDk, i - 6));

  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      {days.map((dk) => {
        // isDueOn already returns false for days before the habit was created
        const due = isDueOn(habit, dk, cal);
        if (!due) {
          return <span key={dk} className="h-1 w-1 rounded-full bg-muted-foreground/25" />;
        }
        const done = isCompleted(habit, getLog(db, habit.id, dk));
        return (
          <span
            key={dk}
            className="h-2 w-2 rounded-full transition-colors"
            style={
              done
                ? { backgroundColor: tint }
                : { boxShadow: `inset 0 0 0 1.5px ${tint}`, opacity: 0.3 }
            }
          />
        );
      })}
    </div>
  );
}

/**
 * Calendar-style month grid for a habit: 7 columns in the calendar's own week
 * order (Jalali starts Saturday, Gregorian starts Sunday) × as many rows
 * as the month needs — muted day number when not
 * done, filled with the category color and a bold number when completed,
 * plain/faint gray for days not due or future. Supports paging to previous
 * months via `monthAnchor` (any date-key inside the month to display).
 */
export function MonthCalendarGrid({
  db,
  habit,
  cal,
  color,
  lang,
  monthAnchor,
}: {
  db: Db;
  habit: Habit;
  cal: Calendar;
  color?: string;
  lang: Lang;
  /** Any date-key within the month to render. Defaults to today. */
  monthAnchor?: string;
}) {
  const days = monthDays(monthAnchor ?? todayKey(), cal);
  const todayK = todayKey();
  const tint = color ?? "var(--primary)";
  const order = weekdayOrder(cal); // Jalali: Sat-first · Gregorian: Sun-first
  const headerLetters = order.map((dow) => weekdayShort(dow, lang).slice(0, 1));

  // pad the front so the 1st of the month lands in its correct weekday column
  const firstDow = keyToDate(days[0]).getDay();
  const leadingBlanks = order.indexOf(firstDow);
  const cells: (string | null)[] = [...Array(leadingBlanks).fill(null), ...days];

  return (
    <div dir="ltr">
      <div className="mb-1 grid grid-cols-7 gap-[3px]">
        {headerLetters.map((l, i) => (
          <div key={i} className="text-center text-[7px] font-semibold tracking-tight text-muted-foreground/80">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[3px]">
        {cells.map((d, i) => {
          if (!d) return <div key={`blank-${i}`} />;
          const due = isDueOn(habit, d, cal);
          const future = d > todayK;
          const done = due && !future && isCompleted(habit, getLog(db, habit.id, d));
          const dnum = dayOfMonth(d, cal);
          const isToday = d === todayK;
          return (
            <div
              key={d}
              title={d}
              className={`flex aspect-square items-center justify-center rounded-[5px] text-[7px] leading-none transition-colors ${
                isToday ? "ring-1 ring-inset ring-primary" : ""
              } ${done ? "font-extrabold" : "font-medium"}`}
              style={
                done
                  ? { backgroundColor: tint, color: "#fff" }
                  : { backgroundColor: "var(--secondary)", color: "var(--muted-foreground)", opacity: due && !future ? 0.65 : 0.3 }
              }
            >
              {faNum(dnum, lang)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Small square-per-day row showing this month's completion so far for a habit. */
export function MonthHeatmap({
  db,
  habit,
  cal,
  color,
}: {
  db: Db;
  habit: Habit;
  cal: Calendar;
  color?: string;
}) {
  const days = monthDays(todayKey(), cal);
  const todayK = todayKey();
  return (
    <div className="flex gap-[3px]">
      {days.map((d) => {
        const due = isDueOn(habit, d, cal);
        const future = d > todayK;
        const done = due && isCompleted(habit, getLog(db, habit.id, d));
        return (
          <span
            key={d}
            title={d}
            className="h-2 flex-1 rounded-[2px] transition-colors"
            style={{
              backgroundColor: !due ? "var(--secondary)" : future ? "var(--secondary)" : done ? color ?? "var(--primary)" : "var(--destructive)",
              opacity: !due || future ? 0.35 : done ? 1 : 0.4,
            }}
          />
        );
      })}
    </div>
  );
}

/* ---------------- habit form ---------------- */

export interface HabitDraft {
  id?: string;
  name: string;
  categoryId: string;
  type: "binary" | "quantity";
  target: number; // for unitKind "time" this is TOTAL MINUTES
  unit: string;
  unitKind: UnitKind;
  scheduleKind: ScheduleKind;
  weekdays: number[];
  monthlyGoal: string; // empty = auto
  reminderTime: string; // empty = none
}

/** All seven weekdays (Sunday=0 … Saturday=6), i.e. an every-day habit. */
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function emptyDraft(categoryId: string): HabitDraft {
  return {
    name: "",
    categoryId,
    type: "binary",
    target: 1,
    unit: "",
    unitKind: "count",
    scheduleKind: "weekdays",
    // پیش‌فرض: همه‌ی روزهای هفته انتخاب شده (روزانه).
    weekdays: [...ALL_WEEKDAYS],
    // پیش‌فرض هدف ماهانهٔ هر عادت جدید ۳۰ روز است؛ کاربر می‌تواند در فرم عوضش کند.
    monthlyGoal: "30",
    reminderTime: "",
  };
}

export function HabitFormModal({
  open,
  onClose,
  draft,
  setDraft,
  categories,
  onSave,
  t,
  lang,
}: {
  open: boolean;
  onClose: () => void;
  draft: HabitDraft;
  setDraft: (d: HabitDraft) => void;
  categories: Category[];
  onSave: () => void;
  t: (fa: string, en: string) => string;
  lang: Lang;
}) {
  const weekdayNames = lang === "fa" ? WEEKDAYS_FA : WEEKDAYS_EN;
  const pickerOrder = weekdayOrder(lang === "fa" ? "jalali" : "gregorian");
  const [reminderPickerOpen, setReminderPickerOpen] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={draft.id ? t("ویرایش عادت", "Edit habit") : t("عادت جدید", "New habit")} wide>
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("نام عادت", "Habit name")}</p>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={t("مثلاً: ۲۰ دقیقه مطالعه", "e.g. Read 20 minutes")}
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("دسته‌بندی", "Category")}</p>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <Chip
                key={c.id}
                active={draft.categoryId === c.id}
                color={c.color}
                onClick={() => setDraft({ ...draft, categoryId: c.id })}
              >
                <CatIcon icon={c.icon} className="h-3 w-3" />
                {lang === "fa" ? c.nameFa : c.nameEn}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("نوع سنجش", "Measurement")}</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDraft({ ...draft, type: "binary", target: 1 })}
              className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                draft.type === "binary" ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {t("انجام شد / نشد", "Done / not done")}
            </button>
            <button
              onClick={() => setDraft({ ...draft, type: "quantity", target: draft.target || 10 })}
              className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                draft.type === "quantity" ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {t("مقداری (عدد + واحد)", "Quantity (amount + unit)")}
            </button>
          </div>
        </div>

        {draft.type === "quantity" && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("واحد سنجش", "Unit type")}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDraft({ ...draft, unitKind: "count", target: draft.target || 10 })}
                  className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                    draft.unitKind === "count" ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {t("تعدادی (عدد + واحد)", "Count (number + unit)")}
                </button>
                <button
                  onClick={() => setDraft({ ...draft, unitKind: "time", target: draft.target || 25 })}
                  className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                    draft.unitKind === "time" ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {t("زمانی (ساعت/دقیقه/ثانیه)", "Time (hr/min/sec)")}
                </button>
              </div>
            </div>

            {draft.unitKind === "count" ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("مقدار هدف", "Target amount")}</p>
                  <Input
                    type="number"
                    dir="ltr"
                    value={draft.target || ""}
                    onChange={(e) => setDraft({ ...draft, target: Number(e.target.value) || 0 })}
                    className="text-center"
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("واحد", "Unit")}</p>
                  <Input
                    value={draft.unit}
                    onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                    placeholder={t("لیوان / عدد / صفحه", "glasses / reps / pages")}
                  />
                </div>
              </div>
            ) : (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("مدت‌زمان هدف", "Target duration")}</p>
                <DurationPicker
                  totalMinutes={draft.target}
                  onChange={(m) => setDraft({ ...draft, target: m })}
                  lang={lang}
                  t={t}
                />
              </div>
            )}
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            {t("روزهای تکرار (حداقل یک روز)", "Repeat on (at least one day)")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {pickerOrder.map((wd) => {
              const on = draft.weekdays.includes(wd);
              return (
                <Chip
                  key={wd}
                  active={on}
                  onClick={() => {
                    // حداقل یک روز باید انتخاب باشد؛ آخرین روز قابل حذف نیست.
                    if (on && draft.weekdays.length === 1) return;
                    setDraft({
                      ...draft,
                      weekdays: on ? draft.weekdays.filter((x) => x !== wd) : [...draft.weekdays, wd],
                    });
                  }}
                >
                  {weekdayNames[wd]}
                </Chip>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              {t("هدف ماهانه (روز)", "Monthly goal (days)")}
            </p>
            <Input
              type="number"
              dir="ltr"
              value={draft.monthlyGoal}
              onChange={(e) => setDraft({ ...draft, monthlyGoal: e.target.value })}
              placeholder={t("خودکار", "auto")}
              className="text-center"
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("یادآوری روزانه", "Daily reminder")}</p>
            <button
              type="button"
              onClick={() => setReminderPickerOpen((v) => !v)}
              className="w-full rounded-xl border border-border px-3 py-2 text-center text-sm font-bold text-foreground hover:bg-secondary"
              dir="ltr"
            >
              {draft.reminderTime || t("خاموش", "Off")}
            </button>
          </div>
        </div>

        {reminderPickerOpen && (
          <div className="rounded-2xl border border-border p-3">
            <TimePicker24
              value={draft.reminderTime || "09:00"}
              onChange={(v) => setDraft({ ...draft, reminderTime: v })}
              lang={lang}
              t={t}
            />
            {draft.reminderTime && (
              <button
                type="button"
                onClick={() => setDraft({ ...draft, reminderTime: "" })}
                className="mt-2 w-full rounded-xl border border-dashed border-border py-1.5 text-xs font-bold text-destructive hover:bg-secondary"
              >
                {t("حذف یادآوری", "Remove reminder")}
              </button>
            )}
          </div>
        )}

        <Button disabled={!draft.name.trim() || draft.weekdays.length === 0} onClick={onSave}>
          {draft.id ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {draft.id ? t("ذخیره تغییرات", "Save changes") : t("اضافه کردن", "Add habit")}
        </Button>
      </div>
    </Modal>
  );
}

export function draftToHabit(draft: HabitDraft, existing?: Habit): Habit {
  const isTime = draft.type === "quantity" && draft.unitKind === "time";
  return {
    id: draft.id ?? uid(),
    name: draft.name.trim(),
    categoryId: draft.categoryId,
    type: draft.type,
    target: draft.type === "binary" ? 1 : Math.max(isTime ? 1 / 60 : 1, draft.target),
    unit: draft.type === "quantity" ? (isTime ? undefined : draft.unit || undefined) : undefined,
    unitKind: draft.type === "quantity" ? draft.unitKind : undefined,
    // همه‌ی هفت روز = روزانه؛ در غیر این‌صورت فقط روزهای انتخاب‌شده.
    schedule:
      draft.weekdays.length >= 7
        ? { kind: "daily", weekdays: undefined }
        : { kind: "weekdays", weekdays: draft.weekdays },
    monthlyGoal: draft.monthlyGoal ? Math.max(1, Number(draft.monthlyGoal)) : null,
    reminderTime: draft.reminderTime || null,
    createdAt: existing?.createdAt ?? Date.now(),
    archived: existing?.archived,
  };
}

export function habitToDraft(h: Habit): HabitDraft {
  return {
    id: h.id,
    name: h.name,
    categoryId: h.categoryId,
    type: h.type,
    target: h.target,
    unit: h.unit ?? "",
    unitKind: h.unitKind ?? "count",
    scheduleKind: "weekdays",
    // روزهای تکرار را از زمان‌بندی می‌سازیم؛ روزانه/فرد/زوجِ قدیمی = همه‌ی روزها.
    weekdays: h.schedule.kind === "weekdays" ? (h.schedule.weekdays ?? [...ALL_WEEKDAYS]) : [...ALL_WEEKDAYS],
    monthlyGoal: h.monthlyGoal ? String(h.monthlyGoal) : "",
    reminderTime: h.reminderTime ?? "",
  };
}

/** Display unit label for a habit: fixed "min" for time habits, custom text for count habits. */
export function habitUnitLabel(h: Habit, t: (fa: string, en: string) => string): string {
  if (h.type !== "quantity") return "";
  if (h.unitKind === "time") return t("دقیقه", "min");
  return h.unit ?? "";
}
