/**
 * Weekly day-picker strip with prev/next arrows and swipe navigation.
 * Used in Home, Tasks, Journal.
 * - Shows 7 days (Sat…Fri for Jalali locale; Sun…Sat for Gregorian).
 * - Arrow keys / left-right swipe move week by week.
 * - Each day is a circle: weekday name above, date number inside,
 *   and a progress ring around the circle showing that day's completion (0-100).
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  addDays,
  dayOfMonth,
  faNum,
  keyToDate,
  todayKey,
  weekdayShort,
  weekStartOf,
  type Calendar,
  type Lang,
} from "@/lib/dates";

const RING_R = 19;
const RING_C = 2 * Math.PI * RING_R;

export function WeekStrip({
  selected,
  onSelect,
  cal,
  lang,
  countFor,
  percentFor,
  emojiFor,
  subLabelFor,
  disableFuture = false,
}: {
  selected: string;
  onSelect: (dk: string) => void;
  cal: Calendar;
  lang: Lang;
  /** Small badge count shown top-corner of the day circle (e.g. items due). */
  countFor?: (dk: string) => number;
  /** 0-100 completion for the progress ring around the day circle. */
  percentFor?: (dk: string) => number | null;
  /** If given, shows this emoji inside the circle instead of the date number (e.g. journal mood). */
  emojiFor?: (dk: string) => string | null;
  /** If given, shows a small label under the circle (e.g. "7/10" journal score). */
  subLabelFor?: (dk: string) => string | null;
  disableFuture?: boolean;
}) {
  const start = weekStartOf(selected, cal);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const todayK = todayKey();

  const shiftWeek = (delta: number) => onSelect(addDays(start, delta * 7));

  // swipe gesture: drag left/right across the strip to change week
  const [dragX, setDragX] = useState(0);
  const startX = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const SWIPE_THRESHOLD = 48;

  const onPointerDown = (e: ReactPointerEvent) => {
    startX.current = e.clientX;
    pointerId.current = e.pointerId;
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (startX.current === null || pointerId.current !== e.pointerId) return;
    setDragX(Math.max(-60, Math.min(60, e.clientX - startX.current)));
  };
  const endDrag = () => {
    if (startX.current === null) return;
    // RTL-aware: dragging right (positive delta) shows the previous week for RTL,
    // but for consistency we treat drag-right as "go back", drag-left as "go forward",
    // matching natural swipe direction regardless of text direction.
    if (dragX > SWIPE_THRESHOLD) shiftWeek(-1);
    else if (dragX < -SWIPE_THRESHOLD) shiftWeek(1);
    startX.current = null;
    pointerId.current = null;
    setDragX(0);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => shiftWeek(-1)}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
        aria-label="prev-week"
      >
        <ChevronRight className="h-4 w-4 ltr:hidden" />
        <ChevronLeft className="h-4 w-4 rtl:hidden" />
      </button>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => startX.current !== null && endDrag()}
        className="grid flex-1 touch-pan-y grid-cols-7 gap-1 select-none"
        style={{ transform: `translateX(${dragX * 0.4}px)`, transition: startX.current ? "none" : "transform 0.2s" }}
      >
        {days.map((dk) => {
          const active = dk === selected;
          const isToday = dk === todayK;
          const isFuture = disableFuture && dk > todayK;
          const dow = keyToDate(dk).getDay();
          const dnum = dayOfMonth(dk, cal);
          const count = countFor ? countFor(dk) : 0;
          const pct = percentFor ? percentFor(dk) : null;
          const ringPct = pct === null ? 0 : Math.max(0, Math.min(100, pct));
          const emoji = emojiFor ? emojiFor(dk) : null;
          const subLabel = subLabelFor ? subLabelFor(dk) : null;

          return (
            <button
              key={dk}
              disabled={isFuture}
              onClick={() => onSelect(dk)}
              className="relative flex flex-col items-center gap-1 py-1 text-[10px] font-medium transition-all disabled:opacity-30"
            >
              <span
                className={`w-full truncate px-0.5 text-center text-[10px] leading-none ${active ? "font-bold text-primary" : "text-muted-foreground"}`}
              >
                {weekdayShort(dow, lang)}
              </span>

              <span className="relative flex h-12 w-12 items-center justify-center">
                <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90">
                  <circle cx="24" cy="24" r={RING_R} fill="none" stroke="var(--secondary)" strokeWidth="3" />
                  {pct !== null && ringPct > 0 && (
                    <circle
                      cx="24"
                      cy="24"
                      r={RING_R}
                      fill="none"
                      stroke={active ? "var(--primary-foreground)" : "var(--primary)"}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={`${(ringPct / 100) * RING_C} ${RING_C}`}
                      className="transition-all duration-500"
                    />
                  )}
                </svg>
                <span
                  className={`z-10 flex h-9 w-9 items-center justify-center rounded-full text-base font-black transition-colors ${
                    emoji
                      ? "bg-transparent text-base"
                      : active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : isToday
                          ? "bg-primary-soft text-primary"
                          : "bg-card text-foreground"
                  }`}
                >
                  {emoji ?? faNum(dnum, lang)}
                </span>
                {count > 0 && (
                  <span
                    className={`absolute -top-0.5 -end-0.5 z-20 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[8px] font-bold ${
                      active ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {faNum(count, lang)}
                  </span>
                )}
              </span>
              {subLabel && (
                <span className={`leading-none ${active ? "font-bold text-primary" : "text-muted-foreground"}`}>
                  {subLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => shiftWeek(1)}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
        aria-label="next-week"
      >
        <ChevronLeft className="h-4 w-4 ltr:hidden" />
        <ChevronRight className="h-4 w-4 rtl:hidden" />
      </button>
    </div>
  );
}
