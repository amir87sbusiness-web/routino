/** Date utilities: Gregorian <-> Jalali conversion, date keys, formatting. */
import { toJalaali, toGregorian, jalaaliMonthLength } from "jalaali-js";

export type Calendar = "jalali" | "gregorian";
export type Lang = "fa" | "en";

export function gregorianToJalali(gy: number, gm: number, gd: number) {
  const r = toJalaali(gy, gm, gd);
  return { jy: r.jy, jm: r.jm, jd: r.jd };
}

export function jalaliToGregorian(jy: number, jm: number, jd: number) {
  const r = toGregorian(jy, jm, jd);
  return { gy: r.gy, gm: r.gm, gd: r.gd };
}

export function jalaliMonthLength(jy: number, jm: number) {
  return jalaaliMonthLength(jy, jm);
}


/** Local date key YYYY-MM-DD (always Gregorian). */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function todayKey() {
  return dateKey(new Date());
}

/** Returns a date-key `n` months away from `key` (any day within that month), clamped to day 1
 * to avoid month-length overflow surprises. Works for both calendars. */
export function addMonths(key: string, n: number, cal: Calendar): string {
  const d = keyToDate(key);
  if (cal === "gregorian") {
    return dateKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
  }
  const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  let jy = j.jy;
  let jm = j.jm + n;
  while (jm > 12) {
    jm -= 12;
    jy += 1;
  }
  while (jm < 1) {
    jm += 12;
    jy -= 1;
  }
  const g = jalaliToGregorian(jy, jm, 1);
  return dateKey(new Date(g.gy, g.gm - 1, g.gd));
}

export const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];
export const GREGORIAN_MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const GREGORIAN_MONTHS_FA = [
  "ژانویه", "فوریه", "مارس", "آوریل", "مه", "ژوئن",
  "ژوئیه", "اوت", "سپتامبر", "اکتبر", "نوامبر", "دسامبر",
];
export const WEEKDAYS_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
export const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Short weekday labels for tight spaces (day-picker chips etc).
 * Persian keeps a readable 1-word abbreviation instead of a mid-word character slice. */
export const WEEKDAYS_FA_SHORT = ["یک", "دو", "سه", "چهار", "پنج", "جمعه", "شنبه"];
export const WEEKDAYS_EN_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Full weekday name for the given lang — e.g. "سه‌شنبه" / "Tuesday". */
export function weekdayFull(dow: number, lang: Lang): string {
  return lang === "fa" ? WEEKDAYS_FA[dow] : WEEKDAYS_EN[dow];
}

/** Short weekday name for the given lang — never slices Persian text mid-word. */
export function weekdayShort(dow: number, lang: Lang): string {
  return lang === "fa" ? WEEKDAYS_FA_SHORT[dow] : WEEKDAYS_EN_SHORT[dow];
}

/** First day (Sat for Jalali, Sun for Gregorian) of the calendar-week containing `key`. */
export function weekStartOf(key: string, cal: Calendar): string {
  const d = keyToDate(key);
  const dow = d.getDay(); // 0..6, Sun..Sat
  // Jalali/Persian week starts Saturday (dow=6). Gregorian: Sunday (0).
  const offset = cal === "jalali" ? (dow + 1) % 7 : dow;
  return addDays(key, -offset);
}

/** getDay() (0=Sun..6=Sat) values in this calendar's natural week order, starting from its first weekday. */
export function weekdayOrder(cal: Calendar): number[] {
  // Jalali: Sat(6) Sun(0) Mon(1) Tue(2) Wed(3) Thu(4) Fri(5)
  // Gregorian: Sun(0) Mon(1) ... Sat(6)
  return cal === "jalali" ? [6, 0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6];
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function faNum(v: number | string, lang: Lang): string {
  const s = String(v);
  if (lang !== "fa") return s;
  return s.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Day-of-month in the given calendar (used for odd/even schedules). */
export function dayOfMonth(key: string, cal: Calendar): number {
  const d = keyToDate(key);
  if (cal === "gregorian") return d.getDate();
  return gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()).jd;
}

/** All date keys of the current calendar-month containing `key`. */
export function monthDays(key: string, cal: Calendar): string[] {
  const d = keyToDate(key);
  if (cal === "gregorian") {
    const y = d.getFullYear();
    const m = d.getMonth();
    const len = new Date(y, m + 1, 0).getDate();
    return Array.from({ length: len }, (_, i) => dateKey(new Date(y, m, i + 1)));
  }
  const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const len = jalaliMonthLength(j.jy, j.jm);
  return Array.from({ length: len }, (_, i) => {
    const g = jalaliToGregorian(j.jy, j.jm, i + 1);
    return dateKey(new Date(g.gy, g.gm - 1, g.gd));
  });
}

export function formatDate(key: string, cal: Calendar, lang: Lang): string {
  const d = keyToDate(key);
  const wd = lang === "fa" ? WEEKDAYS_FA[d.getDay()] : WEEKDAYS_EN[d.getDay()];
  if (cal === "jalali") {
    const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return `${wd}، ${faNum(j.jd, lang)} ${JALALI_MONTHS[j.jm - 1]} ${faNum(j.jy, lang)}`;
  }
  const months = lang === "fa" ? GREGORIAN_MONTHS_FA : GREGORIAN_MONTHS_EN;
  return lang === "fa"
    ? `${wd}، ${faNum(d.getDate(), lang)} ${months[d.getMonth()]} ${faNum(d.getFullYear(), lang)}`
    : `${wd}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatShortDate(key: string, cal: Calendar, lang: Lang): string {
  const d = keyToDate(key);
  if (cal === "jalali") {
    const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return `${faNum(j.jd, lang)} ${JALALI_MONTHS[j.jm - 1]}`;
  }
  const months = lang === "fa" ? GREGORIAN_MONTHS_FA : GREGORIAN_MONTHS_EN;
  return `${faNum(d.getDate(), lang)} ${months[d.getMonth()].slice(0, 3)}`;
}

export function monthTitle(key: string, cal: Calendar, lang: Lang): string {
  const d = keyToDate(key);
  if (cal === "jalali") {
    const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return `${JALALI_MONTHS[j.jm - 1]} ${faNum(j.jy, lang)}`;
  }
  const months = lang === "fa" ? GREGORIAN_MONTHS_FA : GREGORIAN_MONTHS_EN;
  return `${months[d.getMonth()]} ${faNum(d.getFullYear(), lang)}`;
}

const JALALI_MONTHS_SHORT = ["فرو", "ارد", "خرد", "تیر", "مرد", "شهر", "مهر", "آبا", "آذر", "دی", "بهم", "اسف"];
const GREGORIAN_MONTHS_EN_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Day keys for an analytics range, all ending at `today` (rolling windows, so
 * charts show the actual past rather than a mostly-empty current period):
 *  - week: the last 7 days.
 *  - month: the last 31 days.
 *  - quarter: the last 91 days (13 whole weeks).
 *  - year: the last 12 calendar months up to today — calendar-aligned so the
 *    chart can draw exactly one bar per month.
 */
export function analyticsDayKeys(rangeId: string, cal: Calendar, today: string): string[] {
  if (rangeId === "week") return Array.from({ length: 7 }, (_, i) => addDays(today, -(6 - i)));
  if (rangeId === "month") return Array.from({ length: 31 }, (_, i) => addDays(today, -(30 - i)));
  if (rangeId === "quarter") return Array.from({ length: 91 }, (_, i) => addDays(today, -(90 - i)));
  const first = monthDays(addMonths(today, -11, cal), cal)[0];
  const out: string[] = [];
  for (let d = first; d <= today; d = addDays(d, 1)) out.push(d);
  return out;
}

/** One full month name per calendar month across the given bucket-start keys
 * (optionally only every 3rd month), for compact chart axes. */
export function monthLabelsOnce(bucketStartKeys: string[], cal: Calendar, lang: Lang, everyThird: boolean): string[] {
  let lastMonth = -1;
  return bucketStartKeys.map((k) => {
    const mn = monthNumber(k, cal);
    if (mn === lastMonth) return "";
    lastMonth = mn;
    if (everyThird && (mn - 1) % 3 !== 0) return "";
    return monthFull(k, cal, lang);
  });
}

/** Full month name (no year) — e.g. "فروردین" / "January". */
export function monthFull(key: string, cal: Calendar, lang: Lang): string {
  const d = keyToDate(key);
  if (cal === "jalali") {
    const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return JALALI_MONTHS[j.jm - 1];
  }
  return lang === "fa" ? GREGORIAN_MONTHS_FA[d.getMonth()] : GREGORIAN_MONTHS_EN[d.getMonth()];
}

/** Month number 1-12 in the active calendar (Farvardin=1 … / January=1 …). */
export function monthNumber(key: string, cal: Calendar): number {
  const d = keyToDate(key);
  if (cal === "jalali") return gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()).jm;
  return d.getMonth() + 1;
}

/** Short month name only (no year) — used as compact chart-axis labels. */
export function monthShort(key: string, cal: Calendar, lang: Lang): string {
  const d = keyToDate(key);
  if (cal === "jalali") {
    const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return lang === "fa" ? JALALI_MONTHS_SHORT[j.jm - 1] : JALALI_MONTHS[j.jm - 1];
  }
  return lang === "fa" ? GREGORIAN_MONTHS_FA[d.getMonth()] : GREGORIAN_MONTHS_EN_SHORT[d.getMonth()];
}
