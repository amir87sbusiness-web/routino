/**
 * Three-panel weekly day picker with direction-aware, finger-tracking paging.
 * Used in Home, Tasks, and Journal.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useRef,
  type MutableRefObject,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
import { useHorizontalDrag } from "@/components/useHorizontalDrag";
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
import {
  dragDirectionForWeekShift,
  resolveWeekSwipe,
  weekPanelShifts,
} from "@/lib/mobile-gestures";

const RING_R = 19;
const RING_C = 2 * Math.PI * RING_R;
const TRACK_CENTER = "translate3d(-33.333333%, 0, 0)";
const TRACK_LEFT = "translate3d(0, 0, 0)";
const TRACK_RIGHT = "translate3d(-66.666667%, 0, 0)";
const SETTLE_MS = 280;
const SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

interface WeekStripProps {
  selected: string;
  onSelect: (dk: string) => void;
  cal: Calendar;
  lang: Lang;
  /** Small badge count shown top-corner of the day circle (e.g. items due). */
  countFor?: (dk: string) => number;
  /** 0-100 completion for the progress ring around the day circle. */
  percentFor?: (dk: string) => number | null;
  /** If given, shows this emoji inside the circle instead of the date number. */
  emojiFor?: (dk: string) => string | null;
  /** If given, shows a small label under the circle. */
  subLabelFor?: (dk: string) => string | null;
  disableFuture?: boolean;
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function WeekPanel({
  shift,
  selected,
  onSelect,
  cal,
  lang,
  countFor,
  percentFor,
  emojiFor,
  subLabelFor,
  disableFuture = false,
  suppressClickUntil,
}: WeekStripProps & { shift: -1 | 0 | 1; suppressClickUntil: MutableRefObject<number> }) {
  const panelSelected = addDays(selected, shift * 7);
  const start = weekStartOf(panelSelected, cal);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const todayK = todayKey();

  return (
    <div className="grid w-1/3 shrink-0 grid-cols-7 gap-1" dir={lang === "fa" ? "rtl" : "ltr"}>
      {days.map((dk) => {
        const active = dk === panelSelected;
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
            onClick={() => {
              if (Date.now() < suppressClickUntil.current) return;
              onSelect(dk);
            }}
            className="relative flex flex-col items-center gap-1 py-1 text-[10px] font-medium transition-colors disabled:opacity-30"
          >
            <span
              className={`w-full truncate px-0.5 text-center text-[10px] leading-none ${active ? "font-bold text-primary" : "text-muted-foreground"}`}
            >
              {weekdayShort(dow, lang)}
            </span>

            <span className="relative flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90">
                <circle
                  cx="24"
                  cy="24"
                  r={RING_R}
                  fill="none"
                  stroke="var(--secondary)"
                  strokeWidth="3"
                />
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
                    active
                      ? "bg-primary-foreground text-primary"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  {faNum(count, lang)}
                </span>
              )}
            </span>
            {subLabel && (
              <span
                className={`leading-none ${active ? "font-bold text-primary" : "text-muted-foreground"}`}
              >
                {subLabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function WeekStrip(props: WeekStripProps) {
  const { selected, onSelect, lang } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const settlingRef = useRef(false);
  const pendingShiftRef = useRef<-1 | 0 | 1 | null>(null);
  const suppressClickUntil = useRef(0);
  const unlockFrameRef = useRef<number | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTrack = () => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = "none";
    track.style.transform = TRACK_CENTER;
    track.style.willChange = "auto";
  };

  const unlockNextFrame = () => {
    if (unlockFrameRef.current !== null) cancelAnimationFrame(unlockFrameRef.current);
    unlockFrameRef.current = requestAnimationFrame(() => {
      unlockFrameRef.current = null;
      settlingRef.current = false;
    });
  };

  const completeSettle = () => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    const shift = pendingShiftRef.current;
    pendingShiftRef.current = null;
    resetTrack();
    if (shift) onSelect(addDays(selected, shift * 7));
    unlockNextFrame();
  };

  const settle = (shift: -1 | 0 | 1) => {
    if (settlingRef.current) return;
    const track = trackRef.current;
    if (!track) return;
    settlingRef.current = true;
    pendingShiftRef.current = shift;
    suppressClickUntil.current = Date.now() + SETTLE_MS + 80;

    if (reducedMotion()) {
      completeSettle();
      return;
    }

    const dragDirection = shift === 0 ? 0 : dragDirectionForWeekShift(shift, lang);
    track.style.transition = `transform ${SETTLE_MS}ms ${SETTLE_EASING}`;
    track.style.transform =
      dragDirection > 0 ? TRACK_LEFT : dragDirection < 0 ? TRACK_RIGHT : TRACK_CENTER;
    settleTimerRef.current = setTimeout(completeSettle, SETTLE_MS + 40);
  };

  const dragBindings = useHorizontalDrag({
    onStart: () => {
      if (settlingRef.current) return;
      draggingRef.current = true;
      const track = trackRef.current;
      if (!track) return;
      track.style.transition = "none";
      track.style.willChange = "transform";
    },
    onMove: ({ dx }) => {
      if (!draggingRef.current || settlingRef.current) return;
      const width = viewportRef.current?.clientWidth ?? 0;
      const bounded = Math.max(-width, Math.min(width, dx));
      const track = trackRef.current;
      if (track) track.style.transform = `translate3d(calc(-33.333333% + ${bounded}px), 0, 0)`;
    },
    onEnd: ({ dx, velocityX, cancelled }) => {
      if (!draggingRef.current || settlingRef.current) return;
      draggingRef.current = false;
      const shift = cancelled
        ? 0
        : resolveWeekSwipe({
            dx,
            velocityX,
            width: viewportRef.current?.clientWidth ?? 0,
            lang,
          });
      settle(shift);
    },
  });

  useEffect(
    () => () => {
      if (unlockFrameRef.current !== null) cancelAnimationFrame(unlockFrameRef.current);
      if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    },
    [],
  );

  const onTrackTransitionEnd = (event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    if (pendingShiftRef.current === null) return;
    completeSettle();
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => settle(-1)}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
        aria-label="prev-week"
      >
        <ChevronRight className="h-4 w-4 ltr:hidden" />
        <ChevronLeft className="h-4 w-4 rtl:hidden" />
      </button>

      <div
        ref={viewportRef}
        {...dragBindings}
        dir="ltr"
        className="min-w-0 flex-1 touch-pan-y overflow-hidden select-none"
      >
        <div
          ref={trackRef}
          className="flex w-[300%]"
          dir="ltr"
          style={{ transform: TRACK_CENTER }}
          onTransitionEnd={onTrackTransitionEnd}
        >
          {weekPanelShifts(lang).map((shift) => (
            <WeekPanel
              key={shift}
              {...props}
              shift={shift}
              suppressClickUntil={suppressClickUntil}
            />
          ))}
        </div>
      </div>

      <button
        onClick={() => settle(1)}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
        aria-label="next-week"
      >
        <ChevronLeft className="h-4 w-4 ltr:hidden" />
        <ChevronRight className="h-4 w-4 rtl:hidden" />
      </button>
    </div>
  );
}
