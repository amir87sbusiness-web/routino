/**
 * Shared chart bucketing: turns a daily percent series into bars + axis labels,
 * so every trend chart in the app (Analytics overall + habit detail) renders
 * identically:
 *  - week    → 7 bars, one per day (weekday labels)
 *  - month   → 31 bars, one per day (day-of-month label every 5th day)
 *  - quarter → 13 bars, one per week (month name where a new month starts)
 *  - year    → 12 bars, one per calendar month (short month name under each)
 */
import {
  dayOfMonth,
  faNum,
  keyToDate,
  monthLabelsOnce,
  monthNumber,
  monthShort,
  weekdayShort,
  type Calendar,
  type Lang,
} from "./dates";

export type ChartRangeId = "week" | "month" | "quarter" | "year";

export interface ChartPoint {
  dateKey: string;
  percent: number | null;
}

export interface ChartBars {
  buckets: (number | null)[];
  labels: string[];
  /** What one bar spans — drives the "each bar = …" footnote. */
  barUnit: "day" | "week" | "month";
}

const avg = (vals: number[]) => Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

export function buildChartBars(
  series: ChartPoint[],
  rangeId: ChartRangeId,
  cal: Calendar,
  lang: Lang,
): ChartBars {
  if (series.length === 0) return { buckets: [], labels: [], barUnit: "day" };

  if (rangeId === "week" || rangeId === "month") {
    const labels = series.map((p) => {
      if (rangeId === "week") return weekdayShort(keyToDate(p.dateKey).getDay(), lang);
      const d = dayOfMonth(p.dateKey, cal);
      return d % 5 === 0 ? faNum(d, lang) : "";
    });
    return { buckets: series.map((p) => p.percent), labels, barUnit: "day" };
  }

  if (rangeId === "quarter") {
    const buckets: (number | null)[] = [];
    const startKeys: string[] = [];
    for (let i = 0; i < series.length; i += 7) {
      const vals = series
        .slice(i, i + 7)
        .filter((s) => s.percent !== null)
        .map((s) => s.percent as number);
      buckets.push(vals.length ? avg(vals) : null);
      startKeys.push(series[i].dateKey);
    }
    return { buckets, labels: monthLabelsOnce(startKeys, cal, lang, false), barUnit: "week" };
  }

  // year: one bar per calendar month, so bars always line up with their labels
  // (months are 29-31 days; fixed 30-day slices drift off the month grid).
  const buckets: (number | null)[] = [];
  const startKeys: string[] = [];
  let vals: number[] = [];
  let curMonth = Number.NaN;
  for (const p of series) {
    const mn = monthNumber(p.dateKey, cal);
    if (mn !== curMonth) {
      if (!Number.isNaN(curMonth)) buckets.push(vals.length ? avg(vals) : null);
      startKeys.push(p.dateKey);
      curMonth = mn;
      vals = [];
    }
    if (p.percent !== null) vals.push(p.percent);
  }
  buckets.push(vals.length ? avg(vals) : null);
  return { buckets, labels: startKeys.map((k) => monthShort(k, cal, lang)), barUnit: "month" };
}
