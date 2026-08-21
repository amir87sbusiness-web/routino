import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarCheck2, ChevronLeft, ChevronRight, Flame, ListChecks } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AppShell } from "@/components/AppShell";
import { MonthCalendarGrid } from "@/components/habits";
import { Card, CatIcon, Chip, MiniBars, SectionTitle } from "@/components/ui";
import { buildChartBars } from "@/lib/chart";
import {
  addMonths,
  analyticsDayKeys,
  faNum,
  formatShortDate,
  monthTitle,
  todayKey,
  type Calendar,
  type Lang,
} from "@/lib/dates";
import { avgOf, dayScore, weeklyReview, type WeeklyReview } from "@/lib/logic";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/analytics")({
  component: () => (
    <AppShell>
      <AnalyticsPage />
    </AppShell>
  ),
});

const RANGES = [
  { id: "week", days: 7, fa: "هفته", en: "Week" },
  { id: "month", days: 30, fa: "ماه", en: "Month" },
  { id: "quarter", days: 90, fa: "سه‌ماهه", en: "Quarter" },
  { id: "year", days: 365, fa: "سال", en: "Year" },
] as const;

function WeeklyReviewCard({
  review,
  cal,
  lang,
  t,
}: {
  review: WeeklyReview | null;
  cal: Calendar;
  lang: Lang;
  t: (fa: string, en: string) => string;
}) {
  if (!review) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <CalendarCheck2 className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("مرور هفتگی", "Weekly review")}
        </div>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {t(
            "بعد از دو روز کامل که عادت برنامه‌ریزی‌شده داشته باشی، مرور هفتگی اینجا آماده می‌شود.",
            "Your weekly review appears here after two completed days with scheduled habits.",
          )}
        </p>
      </Card>
    );
  }

  const periodLabel =
    review.scope === "week-to-date"
      ? t("این هفته تا روزهای کامل", "This week, completed days")
      : t("هفتهٔ کامل گذشته", "Last completed week");

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <CalendarCheck2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {t("مرور هفتگی", "Weekly review")}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{periodLabel}</p>
        </div>
        <div className="shrink-0 text-end">
          <p className="text-3xl font-black text-foreground">
            {faNum(review.completionPercent, lang)}٪
          </p>
          {review.changePoints === null ? (
            <p className="text-[10px] text-muted-foreground">
              {t("هنوز قابل مقایسه نیست", "Not comparable yet")}
            </p>
          ) : (
            <p
              className={`text-[10px] font-bold ${
                review.changePoints > 0
                  ? "text-success"
                  : review.changePoints < 0
                    ? "text-destructive"
                    : "text-muted-foreground"
              }`}
            >
              {review.changePoints > 0 ? "+" : ""}
              {faNum(review.changePoints, lang)} {t("واحد درصد", "points")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-secondary/60 p-3 text-center">
        <div className="min-w-0">
          <p className="text-base font-black text-foreground">
            {faNum(review.completedCheckIns, lang)}
          </p>
          <p className="text-[10px] text-muted-foreground">{t("ثبت موفق", "Check-ins")}</p>
        </div>
        <div className="min-w-0 border-x border-border px-1">
          <p className="text-base font-black text-foreground">{faNum(review.activeDays, lang)}</p>
          <p className="text-[10px] text-muted-foreground">{t("روز فعال", "Active days")}</p>
        </div>
        <div className="min-w-0">
          <p className="text-base font-black text-foreground">
            {review.previousPercent === null ? "—" : `${faNum(review.previousPercent, lang)}٪`}
          </p>
          <p className="text-[10px] text-muted-foreground">{t("بازهٔ قبل", "Prior period")}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground">{t("قوی‌ترین روز", "Strongest day")}</p>
          <p className="truncate font-bold text-foreground">
            {formatShortDate(review.strongestDay.dateKey, cal, lang)} ·{" "}
            {faNum(review.strongestDay.percent, lang)}٪
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground">{t("ضعیف‌ترین روز", "Weakest day")}</p>
          <p className="truncate font-bold text-foreground">
            {formatShortDate(review.weakestDay.dateKey, cal, lang)} ·{" "}
            {faNum(review.weakestDay.percent, lang)}٪
          </p>
        </div>
        {review.mostConsistentHabit && (
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground">
              {t("منظم‌ترین عادت", "Most consistent")}
            </p>
            <p className="truncate font-bold text-foreground">
              {review.mostConsistentHabit.name} · {faNum(review.mostConsistentHabit.rate, lang)}٪
            </p>
          </div>
        )}
        {review.mostMissedHabit && (
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground">
              {t("بیشترین جاافتادگی", "Most missed")}
            </p>
            <p className="truncate font-bold text-foreground">
              {review.mostMissedHabit.name} · {faNum(review.mostMissedHabit.missed, lang)}{" "}
              {t("بار", "missed")}
            </p>
          </div>
        )}
      </div>

      {review.consistencySignal && (
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs">
          <Flame className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="min-w-0 truncate text-muted-foreground">
            {t("روند فعلی", "Current consistency")}:{" "}
            <b className="text-foreground">{review.consistencySignal.name}</b> ·{" "}
            {faNum(review.consistencySignal.streak, lang)} {t("نوبت پیوسته", "in a row")}
          </p>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-5 text-muted-foreground">
        {review.scope === "week-to-date"
          ? t(
              `${faNum(review.days, lang)} روز کامل با همان بازهٔ هفتهٔ قبل مقایسه شده؛ امروز حساب نشده است.`,
              `${review.days} completed day(s) are compared with the same prior-week span; today is excluded.`,
            )
          : t(
              "چون امروز اولین روز هفته است، دو هفتهٔ کامل قبلی مقایسه شده‌اند.",
              "Because today starts the week, the two previous completed weeks are compared.",
            )}
      </p>
    </Card>
  );
}

function AnalyticsPage() {
  const ctx = useAppMaybe();
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const [monthAnchor, setMonthAnchor] = useState(todayKey());
  const dragStartX = useRef<number | null>(null);
  const [dragX, setDragX] = useState(0);
  if (!ctx?.db) return null;
  const { db, t, lang, cal } = ctx;

  // بازه‌ها همیشه به امروز ختم می‌شوند (پنجرهٔ متحرک) و باکِت‌بندی/برچسب‌ها در
  // buildChartBars مشترک است تا همهٔ نمودارهای اپ یکسان رفتار کنند.
  const TODAY = todayKey();
  const dayKeys = analyticsDayKeys(range.id, cal, TODAY);
  const series = dayKeys.map((dk) => ({
    dateKey: dk,
    percent: dk <= TODAY ? dayScore(db, dk, cal) : null,
  }));
  const { buckets, labels: barLabels, barUnit } = buildChartBars(series, range.id, cal, lang);
  const review = weeklyReview(db, cal, TODAY);
  const habits = db.habits.filter((h) => !h.archived);
  const completedTasks = db.tasks
    .filter((x) => x.done)
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
  const pendingTasks = db.tasks
    .filter((x) => !x.done)
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));

  return (
    <div className="page-stagger flex flex-col gap-5">
      <WeeklyReviewCard review={review} cal={cal} lang={lang} t={t} />

      {/* overall trend */}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="shrink-0 text-sm font-bold text-foreground">
            {t("عملکرد کلی", "Overall performance")}
          </p>
          <div className="scrollbar-none flex gap-1 overflow-x-auto">
            {RANGES.map((r) => (
              <Chip key={r.id} active={range.id === r.id} onClick={() => setRange(r)}>
                {t(r.fa, r.en)}
              </Chip>
            ))}
          </div>
        </div>
        <MiniBars data={buckets} labels={barLabels} lang={lang} />
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          {t("میانگین", "Average")}:{" "}
          <b className="text-foreground">{faNum(avgOf(series), lang)}٪</b>
          {barUnit === "week" && t(` · هر ستون = ${faNum(7, lang)} روز`, " · each bar = 7 days")}
          {barUnit === "month" && t(" · هر ستون = ۱ ماه", " · each bar = 1 month")}
        </p>
      </Card>

      {/* per-habit summary */}
      <section>
        <SectionTitle
          action={
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMonthAnchor((m) => addMonths(m, -1, cal))}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
                aria-label="prev-month"
              >
                <ChevronRight className="h-4 w-4 ltr:hidden" />
                <ChevronLeft className="h-4 w-4 rtl:hidden" />
              </button>
              <span className="min-w-16 text-center text-[11px] font-bold text-foreground">
                {monthTitle(monthAnchor, cal, lang)}
              </span>
              <button
                onClick={() => setMonthAnchor((m) => addMonths(m, 1, cal))}
                disabled={addMonths(monthAnchor, 1, cal) > todayKey()}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary disabled:opacity-30"
                aria-label="next-month"
              >
                <ChevronLeft className="h-4 w-4 ltr:hidden" />
                <ChevronRight className="h-4 w-4 rtl:hidden" />
              </button>
            </div>
          }
        >
          {t("عملکرد هر عادت", "Per-habit performance")}
        </SectionTitle>
        {habits.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("هنوز عادتی نداری.", "No habits yet.")}
          </p>
        ) : (
          <div
            onPointerDown={(e: ReactPointerEvent) => {
              dragStartX.current = e.clientX;
            }}
            onPointerMove={(e: ReactPointerEvent) => {
              if (dragStartX.current === null) return;
              setDragX(Math.max(-40, Math.min(40, e.clientX - dragStartX.current)));
            }}
            onPointerUp={() => {
              if (dragStartX.current === null) return;
              if (dragX > 45 || dragX < -45) {
                // swipe right (positive) = go to previous month, swipe left = next month
                setMonthAnchor((m) => addMonths(m, dragX > 0 ? -1 : 1, cal));
              }
              dragStartX.current = null;
              setDragX(0);
            }}
            onPointerCancel={() => {
              dragStartX.current = null;
              setDragX(0);
            }}
            className="touch-pan-y grid grid-cols-2 gap-2.5"
          >
            {habits.map((h) => {
              const cat = db.categories.find((c) => c.id === h.categoryId);
              return (
                <Link
                  key={h.id}
                  to="/habit/$habitId"
                  params={{ habitId: h.id }}
                  className="card-surface block p-3"
                >
                  {/* ارتفاع ثابتِ دو خط: اسم بلند دوخطی می‌شود ولی اندازهٔ باکس تغییری نمی‌کند. */}
                  <div className="mb-2 flex h-8 items-center gap-1.5">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white"
                      style={{ backgroundColor: cat?.color ?? "#999" }}
                    >
                      <CatIcon icon={cat?.icon ?? "star"} className="h-3 w-3" />
                    </span>
                    <p className="line-clamp-2 min-w-0 flex-1 text-xs font-bold leading-4 text-foreground">
                      {h.name}
                    </p>
                  </div>
                  <div className="mx-auto max-w-52">
                    <MonthCalendarGrid
                      db={db}
                      habit={h}
                      cal={cal}
                      color={cat?.color}
                      lang={lang}
                      monthAnchor={monthAnchor}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* completed vs pending tasks */}
      <section>
        <SectionTitle>{t("وضعیت کارها", "Task status")}</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <p className="mb-1.5 text-center text-[11px] font-bold text-success">
              {t("انجام‌شده", "Done")} ({faNum(completedTasks.length, lang)})
            </p>
            <div className="flex flex-col gap-1.5">
              {completedTasks.length === 0 ? (
                <p className="text-center text-[10px] text-muted-foreground">
                  {t("هنوز کاری نیست.", "None yet.")}
                </p>
              ) : (
                completedTasks.slice(0, 30).map((task) => (
                  <div key={task.id} className="card-surface flex items-center gap-1.5 p-2">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white"
                      style={{ backgroundColor: task.color ?? "var(--primary)" }}
                    >
                      <CatIcon icon={task.icon ?? "star"} className="h-2.5 w-2.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-foreground">
                        {task.title}
                      </p>
                      <p className="text-[9px] text-muted-foreground">
                        {formatShortDate(task.dateKey, cal, lang)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-center text-[11px] font-bold text-muted-foreground">
              {t("انجام‌نشده", "Not done")} ({faNum(pendingTasks.length, lang)})
            </p>
            <div className="flex flex-col gap-1.5">
              {pendingTasks.length === 0 ? (
                <p className="text-center text-[10px] text-muted-foreground">
                  {t("چیزی باقی نمونده 🎉", "Nothing left 🎉")}
                </p>
              ) : (
                pendingTasks.slice(0, 30).map((task) => (
                  <div
                    key={task.id}
                    className="card-surface flex items-center gap-1.5 p-2 opacity-80"
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white"
                      style={{ backgroundColor: task.color ?? "var(--muted-foreground)" }}
                    >
                      <CatIcon icon={task.icon ?? "star"} className="h-2.5 w-2.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-foreground">
                        {task.title}
                      </p>
                      <p className="text-[9px] text-muted-foreground">
                        {formatShortDate(task.dateKey, cal, lang)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <p className="text-center text-[10px] text-muted-foreground">
        {t(
          "کارها در نمودارهای بالا محاسبه نمی‌شوند؛ فقط عادت‌ها.",
          "Tasks aren't counted in the charts above; only habits.",
        )}
      </p>
    </div>
  );
}
