/** Small UI primitives used across Routino. */
import { cn } from "@/lib/utils";
import {
  Ban,
  BookOpen,
  CalendarCheck,
  Dumbbell,
  Gamepad2,
  Heart,
  Moon,
  PawPrint,
  Sparkles,
  Star,
  Sunrise,
  TrendingUp,
  Users,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import {
  addMonths,
  dayOfMonth,
  faNum,
  keyToDate,
  monthDays,
  monthTitle,
  todayKey,
  weekdayOrder,
  weekdayShort,
  type Calendar,
  type Lang,
} from "@/lib/dates";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  sunrise: Sunrise,
  heart: Heart,
  dumbbell: Dumbbell,
  calendar: CalendarCheck,
  sparkles: Sparkles,
  trending: TrendingUp,
  wallet: Wallet,
  utensils: Utensils,
  moon: Moon,
  book: BookOpen,
  zap: Zap,
  gamepad: Gamepad2,
  paw: PawPrint,
  star: Star,
  users: Users,
  ban: Ban,
};

export function CatIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = CATEGORY_ICONS[icon] ?? Star;
  return <Icon className={className ?? "h-4 w-4"} />;
}

/**
 * The app mark.
 *
 * Renders `public/favicon.svg` — the very file `scripts/generate-icons.mjs`
 * produces the home-screen icons from. Re-drawing the same shape inline would
 * create a second source of truth that drifts the first time the brand changes,
 * and the service worker already precaches this, so it costs no request offline.
 *
 * The SVG carries its own rounded orange tile, so it needs no background or
 * radius from the caller — only a size. It deliberately does NOT follow
 * `settings.brandColor`: this is the product's identity, and it should match the
 * icon the user tapped to open the app.
 *
 * Decorative by default (`alt=""`). A clickable wrapper must supply its own
 * `aria-label`, or the link has no accessible name.
 */
export function Logo({ className }: { className?: string }) {
  return <img src="/favicon.svg" alt="" aria-hidden className={cn("shrink-0", className)} />;
}

type BtnVariant = "primary" | "secondary" | "ghost" | "destructive" | "outline";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground hover:opacity-90",
        variant === "secondary" && "bg-secondary text-secondary-foreground hover:bg-accent",
        variant === "ghost" && "text-foreground hover:bg-secondary",
        variant === "outline" && "border border-border bg-card text-foreground hover:bg-secondary",
        variant === "destructive" && "bg-destructive text-destructive-foreground hover:opacity-90",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("card-surface p-4", className)}>{children}</div>;
}

export function Progress({
  value,
  color,
  className,
}: {
  value: number;
  color?: string;
  className?: string;
}) {
  const target = Math.min(100, Math.max(0, value));
  // از صفر شروع می‌کند و بعد از mount به مقدار هدف پر می‌شود تا انیمیشنِ پرشدن دیده شود.
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(target));
    return () => cancelAnimationFrame(id);
  }, [target]);
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}>
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
        style={{ width: `${w}%`, ...(color ? { backgroundColor: color } : {}) }}
      />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button aria-label="close" className="absolute inset-0" onClick={onClose} />
      <div
        className={cn(
          "animate-pop-in relative max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-card px-5 pt-5 pb-modal-safe shadow-2xl sm:rounded-3xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          {title ? <h3 className="text-base font-bold text-card-foreground">{title}</h3> : <span />}
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-base font-bold text-foreground">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="text-4xl">{emoji}</span>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-secondary",
      )}
      style={active && color ? { backgroundColor: color, color: "#fff" } : undefined}
    >
      {children}
    </button>
  );
}

/**
 * Scrollable wheel-style duration picker: person swipes/scrolls each column
 * (hours/minutes/seconds) to the desired value — snaps to the nearest item,
 * like a native time picker. Value is always expressed in total minutes
 * (fractional for seconds < 60), rounded to the nearest minute on commit.
 */
const WHEEL_ITEM_H = 36;

function WheelColumn({
  value,
  max,
  step = 1,
  label,
  lang,
  onChange,
}: {
  value: number;
  max: number; // exclusive upper bound, e.g. 24 or 60
  step?: number;
  label: string;
  lang: "fa" | "en";
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const items = Array.from({ length: Math.ceil(max / step) }, (_, i) => i * step);
  const len = items.length;
  // سه نسخه پشت‌سرهم تا چرخ به‌صورت حلقه‌ای (۵۹→۰، ۲۳→۰ و برعکس) بچرخد.
  const loopItems = [...items, ...items, ...items];
  // موقعیت اسکرول برای قرار گرفتن مقدارِ idx در نسخهٔ وسط.
  const midTop = (idx: number) => (len + idx) * WHEEL_ITEM_H;
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const digits = (v: number) =>
    lang === "fa" ? String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]) : String(v);

  // keep scroll position in sync with external value changes (e.g. reset)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = ((Math.round(value / step) % len) + len) % len;
    const target = midTop(idx);
    if (Math.abs(el.scrollTop - target) > 2) el.scrollTop = target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleScroll = () => {
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const rawIdx = Math.round(el.scrollTop / WHEEL_ITEM_H);
      const idx = ((rawIdx % len) + len) % len; // wrap → looping
      onChange(idx * step);
      // اگر از نسخهٔ وسط خارج شدیم، بی‌صدا به همان مقدار در نسخهٔ وسط برگرد تا
      // همیشه فضای اسکرول در هر دو جهت باقی بماند؛ در غیر این‌صورت فقط snap کن.
      if (rawIdx < len || rawIdx >= 2 * len) el.scrollTop = midTop(idx);
      else el.scrollTo({ top: rawIdx * WHEEL_ITEM_H, behavior: "smooth" });
    }, 120);
  };

  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <div className="relative h-[108px] w-full overflow-hidden rounded-xl border border-border bg-card">
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-9 -translate-y-1/2 rounded-lg bg-primary-soft"
          aria-hidden
        />
        <div
          ref={ref}
          onScroll={handleScroll}
          className="scrollbar-none h-full snap-y snap-mandatory overflow-y-scroll"
          style={{ paddingBlock: `${(108 - WHEEL_ITEM_H) / 2}px` }}
        >
          {loopItems.map((v, p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onChange(v);
                const el = ref.current;
                if (el) el.scrollTo({ top: midTop(v / step), behavior: "smooth" });
              }}
              className="relative z-20 flex w-full snap-center items-center justify-center text-base font-black tabular-nums text-foreground"
              style={{ height: WHEEL_ITEM_H }}
              dir="ltr"
            >
              {digits(v).padStart(2, lang === "fa" ? "۰" : "0")}
            </button>
          ))}
        </div>
      </div>
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

export function DurationPicker({
  totalMinutes,
  onChange,
  lang,
  t,
}: {
  totalMinutes: number;
  onChange: (minutes: number) => void;
  lang: "fa" | "en";
  t: (fa: string, en: string) => string;
}) {
  const totalSeconds = Math.round(totalMinutes * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const setParts = (nh: number, nm: number, ns: number) => {
    const secs = Math.max(0, nh) * 3600 + Math.max(0, nm) * 60 + Math.max(0, ns);
    onChange(Math.round((secs / 60) * 100) / 100);
  };

  return (
    <div className="flex gap-2" dir="ltr">
      <WheelColumn value={h} max={24} label={t("ساعت", "hr")} lang={lang} onChange={(v) => setParts(v, m, s)} />
      <WheelColumn value={m} max={60} label={t("دقیقه", "min")} lang={lang} onChange={(v) => setParts(h, v, s)} />
      <WheelColumn value={s} max={60} step={5} label={t("ثانیه", "sec")} lang={lang} onChange={(v) => setParts(h, m, v)} />
    </div>
  );
}

/** Formats total minutes (possibly fractional) as "1h 20m" / "1س ۲۰د" style short label. */
export function formatDuration(totalMinutes: number, lang: "fa" | "en"): string {
  const totalSeconds = Math.round(totalMinutes * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const digits = (v: number) =>
    lang === "fa" ? String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]) : String(v);
  const parts: string[] = [];
  if (h > 0) parts.push(lang === "fa" ? `${digits(h)}س` : `${digits(h)}h`);
  if (m > 0 || (h === 0 && s === 0)) parts.push(lang === "fa" ? `${digits(m)}د` : `${digits(m)}m`);
  if (s > 0 && h === 0) parts.push(lang === "fa" ? `${digits(s)}ث` : `${digits(s)}s`);
  return parts.join(" ");
}

/** Alarm-style 24-hour time picker (HH:MM, no AM/PM) — used for reminders. */
export function TimePicker24({
  value,
  onChange,
  lang,
  t,
}: {
  /** "HH:MM" 24h string, e.g. "14:30". Empty defaults to "09:00". */
  value: string;
  onChange: (hhmm: string) => void;
  lang: "fa" | "en";
  t: (fa: string, en: string) => string;
}) {
  const [h, m] = (value || "09:00").split(":").map((x) => Number(x) || 0);
  const set = (nh: number, nm: number) => {
    const hh = String(Math.max(0, Math.min(23, nh))).padStart(2, "0");
    const mm = String(Math.max(0, Math.min(59, nm))).padStart(2, "0");
    onChange(`${hh}:${mm}`);
  };
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2" dir="ltr">
        <WheelColumn value={h} max={24} label={t("ساعت", "hour")} lang={lang} onChange={(v) => set(v, m)} />
        <span className="pb-6 text-lg font-black text-muted-foreground">:</span>
        <WheelColumn value={m} max={60} label={t("دقیقه", "min")} lang={lang} onChange={(v) => set(h, v)} />
      </div>
      <p className="text-[10px] text-muted-foreground">{t("سیستم ۲۴ ساعته", "24-hour format")}</p>
    </div>
  );
}

/** Combined date + 24h time picker for scheduling reminders, matching app theme. */
/**
 * Month-grid date picker returning a plain "YYYY-MM-DD" day key. Renders in the
 * active calendar (Jalali or Gregorian) with month paging, so a Persian user
 * picks a Persian date rather than translating from a Gregorian grid.
 */
export function DatePickerCalendar({
  value,
  onChange,
  cal,
  lang,
}: {
  /** Selected day key "YYYY-MM-DD". */
  value: string;
  onChange: (dk: string) => void;
  cal: Calendar;
  lang: Lang;
}) {
  const [anchor, setAnchor] = useState(value || todayKey());
  const days = monthDays(anchor, cal);
  const order = weekdayOrder(cal);
  const todayK = todayKey();
  const leadingBlanks = order.indexOf(keyToDate(days[0]).getDay());
  const cells: (string | null)[] = [...Array(leadingBlanks).fill(null), ...days];

  return (
    <div dir="ltr" className="rounded-2xl border border-border p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setAnchor((m) => addMonths(m, -1, cal))}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
          aria-label="prev-month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-bold text-foreground">{monthTitle(anchor, cal, lang)}</span>
        <button
          type="button"
          onClick={() => setAnchor((m) => addMonths(m, 1, cal))}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary"
          aria-label="next-month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {order.map((dow) => (
          <div key={dow} className="text-center text-[9px] font-semibold text-muted-foreground/80">
            {weekdayShort(dow, lang).slice(0, 2)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`blank-${i}`} />;
          const selected = d === value;
          const isToday = d === todayK;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onChange(d)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-lg text-[11px] transition-colors",
                selected
                  ? "bg-primary font-bold text-primary-foreground"
                  : isToday
                    ? "bg-primary-soft font-bold text-primary"
                    : "text-foreground hover:bg-secondary",
              )}
            >
              {faNum(dayOfMonth(d, cal), lang)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateTimePicker({
  value,
  onChange,
  lang,
  t,
}: {
  /** ISO-like "YYYY-MM-DDTHH:MM" or empty. */
  value: string;
  onChange: (v: string) => void;
  lang: "fa" | "en";
  t: (fa: string, en: string) => string;
}) {
  const now = new Date();
  const [datePart, timePart] = value ? value.split("T") : ["", ""];

  const dayOptions = Array.from({ length: 14 }, (_, i) => {
    const dd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    return dd;
  });

  const setDate = (dd: Date) => {
    const dateStr = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
    onChange(`${dateStr}T${timePart || "09:00"}`);
  };
  const setTime = (hhmm: string) => {
    const dateStr = datePart || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    onChange(`${dateStr}T${hhmm}`);
  };

  const dayLabel = (dd: Date) => {
    const isToday = dd.toDateString() === now.toDateString();
    const tmrw = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const isTomorrow = dd.toDateString() === tmrw.toDateString();
    if (isToday) return t("امروز", "Today");
    if (isTomorrow) return t("فردا", "Tomorrow");
    return dd.toLocaleDateString(lang === "fa" ? "fa-IR" : "en-US", { weekday: "short", day: "numeric", month: "short" });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("روز", "Day")}</p>
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto pb-1">
          {dayOptions.map((dd) => {
            const dateStr = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
            const active = datePart === dateStr || (!datePart && dd.toDateString() === now.toDateString());
            return (
              <button
                key={dateStr}
                onClick={() => setDate(dd)}
                className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
                  active ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground"
                }`}
              >
                {dayLabel(dd)}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("ساعت", "Time")}</p>
        <TimePicker24 value={timePart || "09:00"} onChange={setTime} lang={lang} t={t} />
      </div>
    </div>
  );
}

/** Simple bar chart (SVG-free, div bars). values: 0-100 or null. */
export function MiniBars({
  data,
  color,
  labels,
  height = 96,
  lang = "fa",
}: {
  data: (number | null)[];
  color?: string;
  labels?: string[];
  height?: number;
  lang?: "fa" | "en";
}) {
  const digits = (v: number) =>
    lang === "fa" ? String(v).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]) : String(v);
  // روی موبایل hover نیست؛ با لمسِ هر ستون درصدش نشان داده می‌شود.
  const [active, setActive] = useState<number | null>(null);
  return (
    <div dir="ltr">
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((v, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive((a) => (a === i ? null : i))}
            className="group/bar relative flex h-full flex-1 cursor-pointer flex-col justify-end"
            title={v === null ? "—" : `${digits(v)}%`}
          >
            {v === null ? (
              <div className="mx-auto mb-0.5 h-1 w-1 rounded-full bg-border" />
            ) : (
              <>
                <div
                  className={`pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-1.5 py-0.5 text-[9px] font-bold text-background shadow transition-opacity group-hover/bar:opacity-100 ${active === i ? "opacity-100" : "opacity-0"}`}
                >
                  {digits(v)}%
                </div>
                <div
                  className="w-full rounded-t-md bg-primary/90 transition-all"
                  style={{
                    height: `${Math.max(3, v)}%`,
                    ...(color ? { backgroundColor: color } : {}),
                    opacity: v === 0 ? 0.25 : 1,
                  }}
                />
              </>
            )}
          </button>
        ))}
      </div>
      {labels && (
        <div className="mt-1 flex gap-1">
          {labels.map((l, i) => (
            <div key={i} className="flex-1 whitespace-nowrap text-center text-[9px] text-muted-foreground">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// چرخ رنگ (HSV) برای انتخاب رنگ دلخواه؛ با کشیدن انگشت رنگ همان لحظه اعمال می‌شود.
// ---------------------------------------------------------------------------
function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  let x = (hex || "#f97316").replace("#", "");
  if (x.length === 3) x = x.split("").map((c) => c + c).join("");
  const r = parseInt(x.slice(0, 2), 16) / 255;
  const g = parseInt(x.slice(2, 4), 16) / 255;
  const b = parseInt(x.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Circular HSV colour picker. Drag on the wheel to change hue/saturation and a
 * slider for brightness; `onChange` fires live so the brand colour updates as
 * the finger moves. */
export function ColorWheel({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hsv = hexToHsv(value);

  const pick = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = clientX - rect.left - cx;
    const dy = clientY - rect.top - cy;
    const h = (Math.atan2(dy, dx) * (180 / Math.PI) + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / cx);
    onChange(hsvToHex(h, s, hsv.v || 1));
  };

  const ang = (hsv.h * Math.PI) / 180;
  const knobX = 50 + Math.cos(ang) * hsv.s * 50;
  const knobY = 50 + Math.sin(ang) * hsv.s * 50;

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        ref={ref}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          pick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => dragging.current && pick(e.clientX, e.clientY)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        className="relative aspect-square w-60 max-w-full touch-none rounded-full border border-border"
        style={{
          background:
            "radial-gradient(circle at center, #fff 0%, rgba(255,255,255,0) 70%), conic-gradient(from 90deg, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ background: "#000", opacity: 1 - (hsv.v || 1) }}
        />
        <div
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-lg"
          style={{ left: `${knobX}%`, top: `${knobY}%`, backgroundColor: value }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round((hsv.v || 1) * 100)}
        onChange={(e) => onChange(hsvToHex(hsv.h, hsv.s, Number(e.target.value) / 100))}
        className="h-2 w-60 max-w-full cursor-pointer appearance-none rounded-full"
        style={{ background: `linear-gradient(to right, #000, ${hsvToHex(hsv.h, hsv.s, 1)})` }}
        aria-label="brightness"
      />
      <div className="flex items-center gap-2">
        <span className="h-8 w-8 rounded-full border border-border" style={{ backgroundColor: value }} />
        <span className="font-mono text-sm font-bold text-foreground" dir="ltr">
          {value.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
