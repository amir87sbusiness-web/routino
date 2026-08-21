import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CelebrationModal, HabitRow, useCelebration } from "@/components/habits";
import { TodayTodosCard } from "@/components/tasks";
import { EmptyState, SectionTitle } from "@/components/ui";
import { WeekStrip } from "@/components/WeekStrip";
import { faNum, formatDate, todayKey } from "@/lib/dates";
import { dayScore, dueHabitsOn } from "@/lib/logic";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/")({
  component: () => (
    <AppShell>
      <TodayPage />
    </AppShell>
  ),
});

function TodayPage() {
  const ctx = useAppMaybe();
  const { celebration, clear: clearCelebration } = useCelebration(ctx?.db);
  const [dk, setDk] = useState(todayKey());
  const [ringPct, setRingPct] = useState(0);
  // امتیاز روز را قبل از هر return شرطی حساب می‌کنیم تا ترتیب هوک‌ها همیشه ثابت بماند
  // (قانون هوک‌های ری‌اکت: نباید هوکی بعد از return شرطی صدا زده شود).
  const score = ctx?.db ? dayScore(ctx.db, dk, ctx.cal) : null;
  // حلقه‌ی درصد از صفر با انیمیشن پر می‌شود (موقع باز شدن صفحه و تغییر روز/امتیاز).
  useEffect(() => {
    const id = requestAnimationFrame(() => setRingPct(score ?? 0));
    return () => cancelAnimationFrame(id);
  }, [score]);
  if (!ctx?.db) return null;
  const { db, update, t, lang, cal } = ctx;

  const isToday = dk === todayKey();
  const due = dueHabitsOn(db, dk, cal);
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t("صبح بخیر ☀️", "Good morning ☀️")
      : hour < 18
        ? t("ظهر بخیر 🌤", "Good afternoon 🌤")
        : t("عصر بخیر 🌙", "Good evening 🌙");

  const habitCount = (k: string) => dueHabitsOn(db, k, cal).length;

  return (
    <div className="page-stagger flex flex-col gap-6">
      {/* header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black leading-tight text-foreground">{greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDate(dk, cal, lang)}</p>
        </div>
        {score !== null && (
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
            <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="var(--secondary)"
                strokeWidth="3.2"
              />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeDasharray={`${(ringPct / 100) * 97.4} 97.4`}
                className="transition-[stroke-dasharray] duration-1000 ease-out"
              />
            </svg>
            <span className="absolute text-base font-black text-foreground">
              {faNum(score, lang)}٪
            </span>
          </div>
        )}
      </div>

      {/* week strip */}
      <WeekStrip
        selected={dk}
        onSelect={setDk}
        cal={cal}
        lang={lang}
        countFor={habitCount}
        percentFor={(k) => dayScore(db, k, cal)}
      />
      {!isToday && (
        <button
          onClick={() => setDk(todayKey())}
          className="-mt-3 self-center text-[10px] font-medium text-primary"
        >
          {t("برو به امروز", "Go to today")}
        </button>
      )}

      {/* today's tasks */}
      <section>
        <SectionTitle
          action={
            <Link to="/tasks" className="text-xs font-medium text-primary">
              {t("همه کارها", "All tasks")}
            </Link>
          }
        >
          {t("کارها", "Tasks")}
        </SectionTitle>
        {/* بسته باز می‌شود: صفحه‌ی امروز مالِ عادت‌هاست و نوار کارها وقتی چند کار
            داشته باشی کل صفحه را می‌گرفت. سرِ کارت شمارش «انجام‌شده/کل» را نشان
            می‌دهد، پس بدون باز کردن هم می‌فهمی چیزی مانده یا نه. */}
        <TodayTodosCard
          db={db}
          dateKey={dk}
          lang={lang}
          t={t}
          onUpdate={update}
          defaultOpen={false}
        />
      </section>

      {/* habits due */}
      <section>
        <SectionTitle
          action={
            <Link to="/habits" className="flex items-center text-xs font-medium text-primary">
              {t("مدیریت", "Manage")}{" "}
              <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-0 ltr:rotate-180" />
            </Link>
          }
        >
          {isToday
            ? t("عادت‌های امروز", "Today's habits")
            : t("عادت‌های این روز", "Habits for this day")}
        </SectionTitle>
        {due.length === 0 ? (
          <div className="card-surface">
            <EmptyState
              emoji="🌱"
              text={t(
                "هنوز عادتی نداری؛ از بخش عادت‌ها اضافه کن!",
                "No habits yet. Add one from Habits!",
              )}
            />
            <div className="flex justify-center pb-4">
              <Link
                to="/habits"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                <Plus className="h-4 w-4" /> {t("افزودن عادت", "Add habit")}
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {due.map((h) => (
              <HabitRow
                key={h.id}
                db={db}
                habit={h}
                cal={cal}
                lang={lang}
                t={t}
                dk={dk}
                onUpdate={update}
              />
            ))}
          </div>
        )}
      </section>

      <CelebrationModal celebration={celebration} onClose={clearCelebration} t={t} lang={lang} />
    </div>
  );
}
