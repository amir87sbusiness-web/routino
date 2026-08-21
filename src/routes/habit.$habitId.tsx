import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Flame, Target, TrendingUp } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CatIcon, Chip, MiniBars, Progress } from "@/components/ui";
import { buildChartBars } from "@/lib/chart";
import { analyticsDayKeys, faNum, formatShortDate, monthTitle, todayKey } from "@/lib/dates";
import {
  avgOf,
  cappedPercent,
  getLog,
  isDueOn,
  monthProgress,
  streak,
  successRate,
} from "@/lib/logic";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/habit/$habitId")({
  component: () => (
    <AppShell>
      <HabitDetailPage />
    </AppShell>
  ),
});

const RANGES = [
  { id: "week", days: 7, fa: "هفته", en: "Week" },
  { id: "month", days: 30, fa: "ماه", en: "Month" },
  { id: "quarter", days: 90, fa: "سه‌ماهه", en: "Quarter" },
  { id: "year", days: 365, fa: "سال", en: "Year" },
] as const;

function HabitDetailPage() {
  const { habitId } = Route.useParams();
  const ctx = useAppMaybe();
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[0]);

  if (!ctx?.db) return null;
  const { db, t, lang, cal } = ctx;
  const habit = db.habits.find((h) => h.id === habitId);

  if (!habit) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("عادت پیدا نشد.", "Habit not found.")}</p>
        <Link to="/habits" className="mt-3 inline-block text-sm font-medium text-primary">
          {t("بازگشت به عادت‌ها", "Back to habits")}
        </Link>
      </div>
    );
  }

  const cat = db.categories.find((c) => c.id === habit.categoryId);
  const mp = monthProgress(db, habit, cal);
  const st = streak(db, habit, cal);
  const rate = successRate(db, habit, cal, range.days);

  // Rolling windows ending today; bucketing + labels shared with Analytics via
  // buildChartBars so every chart in the app behaves identically.
  const TODAY = todayKey();
  const dayKeys = analyticsDayKeys(range.id, cal, TODAY);
  const series = dayKeys.map((dk) => ({
    dateKey: dk,
    percent:
      dk > TODAY
        ? null
        : isDueOn(habit, dk, cal)
          ? cappedPercent(habit, getLog(db, habit.id, dk))
          : null,
  }));
  const { buckets, labels: barLabels, barUnit } = buildChartBars(series, range.id, cal, lang);

  return (
    <div className="page-stagger flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Link to="/habits" className="rounded-full p-2 text-muted-foreground hover:bg-secondary">
          <ArrowRight className="h-5 w-5 ltr:rotate-180" />
        </Link>
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: cat?.color ?? "#999" }}
        >
          <CatIcon icon={cat?.icon ?? "star"} className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-base font-black text-foreground">{habit.name}</h1>
          <p className="text-[10px] text-muted-foreground">
            {lang === "fa" ? cat?.nameFa : cat?.nameEn}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card className="flex flex-col items-center gap-1 py-3">
          <Flame className="h-5 w-5 text-primary" />
          <p className="text-lg font-black text-foreground">{faNum(st, lang)}</p>
          <p className="text-[10px] text-muted-foreground">{t("استریک", "Streak")}</p>
        </Card>
        <Card className="flex flex-col items-center gap-1 py-3">
          <TrendingUp className="h-5 w-5 text-primary" />
          <p className="text-lg font-black text-foreground">{faNum(rate, lang)}٪</p>
          <p className="text-[10px] text-muted-foreground">{t("موفقیت", "Success")}</p>
        </Card>
        <Card className="flex flex-col items-center gap-1 py-3">
          <Target className="h-5 w-5 text-primary" />
          <p className="text-lg font-black text-foreground">
            {faNum(mp.doneDays, lang)}/{faNum(mp.goalDays, lang)}
          </p>
          <p className="text-[10px] text-muted-foreground">{t("این ماه", "This month")}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-bold text-foreground">
            {t("هدف ماهانه:", "Monthly goal:")} {monthTitle(todayKey(), cal, lang)}
          </p>
          <span className="text-xs font-black text-primary">{faNum(mp.percent, lang)}٪</span>
        </div>
        <Progress value={mp.percent} color={cat?.color} />
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="shrink-0 text-sm font-bold text-foreground">{t("روند انجام", "Trend")}</p>
          <div className="scrollbar-none flex gap-1 overflow-x-auto">
            {RANGES.map((r) => (
              <Chip key={r.id} active={range.id === r.id} onClick={() => setRange(r)}>
                {t(r.fa, r.en)}
              </Chip>
            ))}
          </div>
        </div>
        <MiniBars data={buckets} color={cat?.color} labels={barLabels} lang={lang} />
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          {t("میانگین این بازه", "Range average")}:{" "}
          <b className="text-foreground">{faNum(avgOf(series), lang)}٪</b>
          {barUnit === "week" && t(` · هر ستون = ${faNum(7, lang)} روز`, " · each bar = 7 days")}
          {barUnit === "month" && t(" · هر ستون = ۱ ماه", " · each bar = 1 month")}
        </p>
      </Card>

      {/* recent notes */}
      {Object.values(db.logs).filter((l) => l.habitId === habit.id && (l.note || l.mood)).length >
        0 && (
        <Card>
          <p className="mb-2 text-sm font-bold text-foreground">
            {t("یادداشت‌های اخیر", "Recent notes")}
          </p>
          <div className="flex flex-col gap-2">
            {Object.values(db.logs)
              .filter((l) => l.habitId === habit.id && (l.note || l.mood))
              .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
              .slice(0, 10)
              .map((l) => (
                <div
                  key={l.dateKey}
                  className="flex items-start gap-2 rounded-xl bg-secondary/60 p-2.5"
                >
                  <span className="text-base">{l.mood || "📝"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-muted-foreground">
                      {formatShortDate(l.dateKey, cal, lang)}
                    </p>
                    {l.note && <p className="text-xs text-foreground">{l.note}</p>}
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}
