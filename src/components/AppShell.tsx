/**
 * AppShell: gating (onboarding → auth → subscription), navigation
 * (bottom bar on mobile, sidebar on desktop), notification center,
 * feedback popup, and celebration popups.
 */
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  BookHeart,
  Home,
  ListTodo,
  Repeat,
  Settings,
  Timer,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { InstallBanner } from "@/components/pwa";
import { Button, Logo, Modal } from "@/components/ui";
import { faNum } from "@/lib/dates";
import { subscriptionActive } from "@/lib/logic";
import { requestPersistentStorage } from "@/lib/pwa";
import { uid } from "@/lib/store";
import { useAppMaybe } from "@/state/app";

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Logo className="h-16 w-16" />
        <p className="text-sm font-medium text-muted-foreground">روتینو · Routino</p>
      </div>
    </div>
  );
}

const NAV = [
  { to: "/", icon: Home, fa: "امروز", en: "Today" },
  { to: "/habits", icon: Repeat, fa: "عادت‌ها", en: "Habits" },
  { to: "/tasks", icon: ListTodo, fa: "کارها", en: "Tasks" },
  { to: "/timer", icon: Timer, fa: "تایمر", en: "Timer" },
  { to: "/journal", icon: BookHeart, fa: "ژورنال", en: "Journal" },
  { to: "/analytics", icon: BarChart3, fa: "آنالیز", en: "Stats" },
  { to: "/settings", icon: Settings, fa: "تنظیمات", en: "Settings" },
] as const;

// bottom nav on mobile keeps Settings out — it stays accessible via the top header icon only
const BOTTOM_NAV = NAV.filter((item) => item.to !== "/settings");

export function AppShell({ children }: { children: ReactNode }) {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [notifOpen, setNotifOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [fbSection, setFbSection] = useState("");
  const [fbComment, setFbComment] = useState("");

  const db = ctx?.db ?? null;
  const gate = useMemo(() => {
    if (!db) return "loading";
    if (!db.settings.onboarded) return "onboarding";
    if (!db.auth) return "auth";
    if (!subscriptionActive(db)) return "subscribe";
    return "ok";
  }, [db]);

  useEffect(() => {
    if (gate === "onboarding") navigate({ to: "/onboarding" });
    else if (gate === "auth") navigate({ to: "/auth" });
    else if (gate === "subscribe") navigate({ to: "/subscribe" });
  }, [gate, navigate]);

  // Ask the browser to keep our data as soon as onboarding is done — before the
  // auth/subscribe screens — so everything entered from then on is under durable
  // storage. IndexedDB is the only copy of their habits until sync exists, and
  // Safari evicts origin storage after 7 days without interaction; this stops
  // that. Not fired on the first onboarding paint on purpose: a few browsers
  // prompt for it, and engagement makes the grant likelier. The call no-ops when
  // durability is already granted, so re-running it is free.
  useEffect(() => {
    if (db?.settings.onboarded) void requestPersistentStorage();
  }, [db?.settings.onboarded]);

  // periodic feedback popup: every 5 sessions
  useEffect(() => {
    if (!db || gate !== "ok") return;
    const { sessions, lastFeedbackSession } = db.meta;
    if (sessions >= 3 && sessions - lastFeedbackSession >= 5) {
      const timer = setTimeout(() => setFeedbackOpen(true), 4000);
      return () => clearTimeout(timer);
    }
  }, [db, gate]);

  if (!ctx || !db) return <Splash />;
  if (gate !== "ok") return <Splash />;

  const { t, lang, update } = ctx;
  const unread = db.notifications.filter((n) => !n.read).length;

  const submitFeedback = (skip: boolean) => {
    update((d) => ({
      ...d,
      feedback: skip
        ? d.feedback
        : [
            {
              id: uid(),
              rating,
              section: rating <= 3 ? fbSection : undefined,
              comment: fbComment || undefined,
              at: Date.now(),
              phone: d.auth?.phone,
            },
            ...d.feedback,
          ],
      meta: { ...d.meta, lastFeedbackSession: d.meta.sessions },
    }));
    setFeedbackOpen(false);
    setRating(0);
    setFbSection("");
    setFbComment("");
  };

  return (
    <div className="min-h-screen bg-background lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-border bg-card p-4 lg:flex">
        {/* The logo is decorative (alt=""), so the link needs its own name. */}
        <Link
          to="/settings"
          aria-label={t("تنظیمات", "Settings")}
          className="mb-6 flex items-center gap-2.5 rounded-2xl px-2 py-1 transition-colors hover:bg-secondary"
        >
          <Logo className="h-10 w-10" />
          <div>
            <p className="text-sm font-black text-foreground">{t("روتینو", "Routino")}</p>
            <p className="text-[10px] text-muted-foreground">{t("عادت‌ساز روزانه", "Daily habit builder")}</p>
          </div>
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className="h-4.5 w-4.5" />
                {t(item.fa, item.en)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-2 text-[10px] text-muted-foreground">
          {t("ذخیره‌شده روی این دستگاه", "Saved on this device")}
        </div>
      </aside>

      <div className="mx-auto w-full max-w-2xl flex-1 pb-nav lg:pb-8">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 pb-2 pt-safe backdrop-blur-md lg:rounded-b-2xl">
          <Link
            to="/settings"
            aria-label={t("تنظیمات", "Settings")}
            className="-mx-1 flex items-center gap-2 rounded-xl px-1 py-0.5 transition-colors hover:bg-secondary lg:hidden"
          >
            <Logo className="h-8 w-8" />
            <span className="text-sm font-black text-foreground">{t("روتینو", "Routino")}</span>
          </Link>
          <span className="hidden text-sm font-bold text-foreground lg:block">
            {NAV.find((n) => n.to === pathname)
              ? t(
                  NAV.find((n) => n.to === pathname)!.fa,
                  NAV.find((n) => n.to === pathname)!.en,
                )
              : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setNotifOpen(true)}
              className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary"
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -end-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  {faNum(unread, lang)}
                </span>
              )}
            </button>
            <Link
              to="/settings"
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary lg:hidden"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </header>

        <InstallBanner />
        <main className="px-4 py-4">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-safe backdrop-blur-md lg:hidden">
        <div className="mx-auto flex max-w-2xl items-stretch">
          {BOTTOM_NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-1 flex-col items-center gap-1 px-0.5 pt-2.5 pb-1 text-xs font-medium leading-tight transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-6 w-6" />
                <span className="truncate">{t(item.fa, item.en)}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Notification center */}
      <Modal open={notifOpen} onClose={() => setNotifOpen(false)} title={t("اعلان‌ها", "Notifications")}>
        {db.notifications.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("اعلانی نداری 🎈", "No notifications yet 🎈")}
          </p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {db.notifications.map((n) => (
              <div key={n.id} className={`rounded-xl border border-border p-3 ${n.read ? "opacity-60" : ""}`}>
                <p className="text-sm font-bold text-foreground">{n.title}</p>
                <p className="text-xs text-muted-foreground">{n.body}</p>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() =>
                update((d) => ({ ...d, notifications: d.notifications.map((n) => ({ ...n, read: true })) }))
              }
            >
              {t("خواندن همه", "Mark all read")}
            </Button>
          </div>
        )}
      </Modal>

      {/* Feedback popup */}
      <Modal open={feedbackOpen} onClose={() => submitFeedback(true)} title={t("نظرت درباره روتینو؟", "How is Routino?")}>
        <div className="flex flex-col gap-4">
          <div className="flex justify-center gap-2" dir="ltr">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                onClick={() => setRating(s)}
                className={`text-3xl transition-transform hover:scale-110 ${s <= rating ? "" : "opacity-30 grayscale"}`}
              >
                ⭐
              </button>
            ))}
          </div>
          {rating > 0 && rating <= 3 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("کدوم بخش نیاز به بهبود داره؟", "Which part needs improvement?")}
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  ["habits", t("عادت‌ها", "Habits")],
                  ["tasks", t("کارها", "Tasks")],
                  ["journal", t("ژورنال", "Journal")],
                  ["analytics", t("آنالیز", "Analytics")],
                  ["design", t("ظاهر برنامه", "Design")],
                  ["other", t("سایر", "Other")],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFbSection(key)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      fbSection === key
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <textarea
                value={fbComment}
                onChange={(e) => setFbComment(e.target.value)}
                placeholder={t("توضیح بیشتر (اختیاری)", "More details (optional)")}
                className="min-h-16 w-full rounded-xl border border-input bg-card p-3 text-sm outline-none focus:border-ring"
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={rating === 0} onClick={() => submitFeedback(false)}>
              {t("ثبت نظر", "Submit")}
            </Button>
            <Button variant="ghost" onClick={() => submitFeedback(true)}>
              {t("بعداً", "Later")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
