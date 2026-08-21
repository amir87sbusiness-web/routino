import { describe, expect, it } from "vitest";
import { buildChartBars, type ChartPoint } from "./chart";
import { analyticsDayKeys } from "./dates";

const TODAY = "2026-07-17";

const flatSeries = (keys: string[], percent: number | null = 50): ChartPoint[] =>
  keys.map((dateKey) => ({ dateKey, percent }));

describe("analyticsDayKeys", () => {
  it("month is a rolling 31-day window ending today", () => {
    const keys = analyticsDayKeys("month", "jalali", TODAY);
    expect(keys).toHaveLength(31);
    expect(keys[keys.length - 1]).toBe(TODAY);
    expect(keys[0]).toBe("2026-06-17");
  });

  it("week and quarter are rolling windows ending today", () => {
    expect(analyticsDayKeys("week", "gregorian", TODAY)).toHaveLength(7);
    const quarter = analyticsDayKeys("quarter", "gregorian", TODAY);
    expect(quarter).toHaveLength(91);
    expect(quarter[quarter.length - 1]).toBe(TODAY);
  });

  it("year spans the last 12 calendar months up to today", () => {
    for (const cal of ["jalali", "gregorian"] as const) {
      const keys = analyticsDayKeys("year", cal, TODAY);
      expect(keys[keys.length - 1]).toBe(TODAY);
      // ~11 whole months + the current partial one
      expect(keys.length).toBeGreaterThan(330);
      expect(keys.length).toBeLessThan(370);
    }
  });
});

describe("buildChartBars", () => {
  it("month renders one bar per day (31 columns)", () => {
    const keys = analyticsDayKeys("month", "jalali", TODAY);
    const { buckets, labels, barUnit } = buildChartBars(flatSeries(keys), "month", "jalali", "fa");
    expect(buckets).toHaveLength(31);
    expect(labels).toHaveLength(31);
    expect(barUnit).toBe("day");
    // day-of-month label appears only on multiples of 5
    expect(labels.filter(Boolean).length).toBe(6);
  });

  it("quarter renders 13 weekly bars", () => {
    const keys = analyticsDayKeys("quarter", "jalali", TODAY);
    const { buckets, barUnit } = buildChartBars(flatSeries(keys), "quarter", "jalali", "fa");
    expect(buckets).toHaveLength(13);
    expect(barUnit).toBe("week");
  });

  it("year renders exactly 12 month-aligned bars with a label per month", () => {
    for (const cal of ["jalali", "gregorian"] as const) {
      const keys = analyticsDayKeys("year", cal, TODAY);
      const { buckets, labels, barUnit } = buildChartBars(flatSeries(keys), "year", cal, "fa");
      expect(buckets).toHaveLength(12);
      expect(labels).toHaveLength(12);
      expect(labels.every(Boolean)).toBe(true);
      expect(barUnit).toBe("month");
    }
  });

  it("year buckets average only the days that have data", () => {
    const keys = analyticsDayKeys("year", "gregorian", TODAY);
    // only the final day has a value → last bucket 80, earlier full months null
    const series = keys.map((dateKey, i) => ({
      dateKey,
      percent: i === keys.length - 1 ? 80 : null,
    }));
    const { buckets } = buildChartBars(series, "year", "gregorian", "fa");
    expect(buckets[buckets.length - 1]).toBe(80);
    expect(buckets.slice(0, -1).every((b) => b === null)).toBe(true);
  });

  it("handles an empty series", () => {
    expect(buildChartBars([], "year", "jalali", "fa")).toEqual({
      buckets: [],
      labels: [],
      barUnit: "day",
    });
  });
});
