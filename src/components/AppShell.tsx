/**
 * AppShell: gating (onboarding → auth → activation/subscription), navigation
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
  LockKeyhole,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FeedbackModal } from "@/components/FeedbackModal";
import { InstallBanner } from "@/components/pwa";
import { Button, Logo, Modal } from "@/components/ui";
import { faNum } from "@/lib/dates";
import { accessRoute, accessState } from "@/lib/access-state";
import { requestPersistentStorage } from "@/lib/pwa";
import { useAppMaybe } from "@/state/app";

/** فاصله‌ی کمینه بین دو بار نشان دادن پاپ‌آپ نظرسنجی. */
const FEEDBACK_INTERVAL = 24 * 60 * 60 * 1000;

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

function ReconnectGate({
  t,
  retry,
}: {
  t: (fa: string, en: string) => string;
  retry: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-sm">
        <WifiOff className="mx-auto mb-4 h-8 w-8 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-black text-foreground">
          {t("یک اتصال کوتاه لازم است", "A quick connection is needed")}
        </h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {t(
            "برای امنیت حسابت، دستگاه باید دوباره آنلاین تأیید شود. اطلاعاتت روی دستگاه و فضای ابری حسابت محفوظ است و پاک نمی‌شود.",
            "For account security, this device must be verified online again. Your data remains safe on this device and in your account cloud.",
          )}
        </p>
        <Button
          className="mt-5 w-full"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void retry().finally(() => setBusy(false));
          }}
        >
          {busy ? t("در حال بررسی…", "Checking…") : t("بررسی دوباره", "Check again")}
        </Button>
        <p className="mt-4 text-xs leading-6 text-muted-foreground">
          {t(
            "اگر مشکل ادامه داشت به @routino_support پیام بده.",
            "If this continues, message @routino_support.",
          )}
        </p>
      </section>
    </main>
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

  const db = ctx?.db ?? null;
  const gate = useMemo(() => {
    if (!db) return "loading";
    if (!db.settings.onboarded) return "onboarding";
    return accessState(db, ctx?.sessionGate ?? "checking");
  }, [db, ctx?.sessionGate]);

  useEffect(() => {
    if (gate === "onboarding") navigate({ to: "/onboarding" });
    else if (gate !== "loading") {
      const destination = accessRoute(gate);
      if (destination) navigate({ to: destination });
    }
  }, [gate, navigate]);

  // Ask the browser to keep our data as soon as onboarding is done — before the
  // auth/activation screens — so everything entered from then on is under durable
  // storage. IndexedDB is the UI's local source and sync supplies the account's
  // cloud copy. Persistence still reduces offline eviction risk, but browsers
  // control their own storage and an explicit Clear site data always wins. Not fired on the first onboarding paint:
  // prompt for it, and engagement makes the grant likelier. The call no-ops when
  // durability is already granted, so re-running it is free.
  useEffect(() => {
    if (db?.settings.onboarded) void requestPersistentStorage();
  }, [db?.settings.onboarded]);

  /**
   * پاپ‌آپ نظرسنجی: حداکثر روزی یک‌بار، و حداکثر یک‌بار در هر بار باز کردن اپ.
   *
   * قبلاً شرط «هر ۵ تا session» بود، ولی هر بار بالا آمدنِ اپ یک session است و
   * روی وب هر رفرش هم یک بالا آمدن — پس یک روز عادیِ کار با برنامه چند بار
   * پاپ‌آپ می‌داد. حالا معیار زمان است.
   *
   * `askedThisBoot` جداگانه لازم است: `lastFeedbackAt` فقط وقتی جلو می‌رود که
   * کاربر جواب بدهد یا «بعداً» را بزند. بدون این پرچم، اگر همان لحظه تبی عوض
   * می‌شد یا کامپوننت دوباره mount می‌شد، تایمر ۴ ثانیه‌ای از نو راه می‌افتاد.
   */
  const askedThisBoot = useRef(false);
  // شرط به شکل یک boolean حساب می‌شود و خودِ `db` در وابستگی‌های افکت نیست.
  // این عمدی است: `db` مدام عوض می‌شود (زمان‌بندِ یادآورها، ذخیره‌سازی، تازه‌سازی
  // اشتراک)، و اگر افکت با هر تغییرِ آن دوباره اجرا شود، cleanup همان تایمرِ ۴
  // ثانیه‌ای را می‌کُشد و اجرای بعدی هم به‌خاطر `askedThisBoot` زود برمی‌گردد —
  // یعنی پاپ‌آپ هیچ‌وقت باز نمی‌شود. (دقیقاً همین اتفاق افتاد و تست گرفتش.)
  const writeActive = gate === "active-trial" || gate === "active-paid";
  const canAsk =
    writeActive &&
    !!db &&
    db.meta.sessions >= 3 &&
    Date.now() - db.meta.lastFeedbackAt >= FEEDBACK_INTERVAL;
  useEffect(() => {
    if (!canAsk || askedThisBoot.current) return;
    askedThisBoot.current = true;
    const timer = setTimeout(() => setFeedbackOpen(true), 4000);
    return () => clearTimeout(timer);
  }, [canAsk]);

  /** بعد از ثبت یا رد کردن، ساعت را جلو ببر تا تا فردا دوباره پرسیده نشود. */
  const closeFeedback = () => {
    setFeedbackOpen(false);
    ctx?.recordFeedbackPrompt();
  };

  if (!ctx || !db) return <Splash />;
  if (gate === "needs-online-verification") {
    return <ReconnectGate t={ctx.t} retry={ctx.retrySession} />;
  }
  if (!writeActive && gate !== "expired") return <Splash />;

  const { t, lang } = ctx;
  const unread = db.notifications.filter((n) => !n.read).length;

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
            <p className="text-[10px] text-muted-foreground">
              {t("عادت‌ساز روزانه", "Daily habit builder")}
            </p>
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
                  active
                    ? "bg-primary-soft text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className="h-4.5 w-4.5" />
                {t(item.fa, item.en)}
              </Link>
            );
          })}
        </nav>
        {/* Said "saved on this device" back when that was the whole truth. Sync
            now copies the account to the server and back down to every device
            the user signs in on, and that is exactly the reassurance someone
            worries about when they pick up a new phone — so say it. */}
        <div className="mt-auto px-2 text-[10px] text-muted-foreground">
          {t(
            "ذخیره‌شده روی دستگاه و فضای ابری حسابت",
            "Saved on this device and your account cloud",
          )}
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
              ? t(NAV.find((n) => n.to === pathname)!.fa, NAV.find((n) => n.to === pathname)!.en)
              : ""}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setNotifOpen(true)}
              // آیکون تنها = برای اسکرین‌ریدر فقط «دکمه». عدد نخوانده‌ها هم داخل
              // نام می‌آید تا کاربر نابینا بدون باز کردن پنل بفهمد چیزی هست.
              aria-label={
                unread > 0
                  ? t(
                      `اعلان‌ها، ${faNum(unread, lang)} خوانده‌نشده`,
                      `Notifications, ${unread} unread`,
                    )
                  : t("اعلان‌ها", "Notifications")
              }
              className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary"
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
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

        {gate === "expired" && (
          <Link
            to="/subscribe"
            className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-primary/25 bg-primary-soft px-3 py-2 text-xs leading-5 text-foreground"
          >
            <LockKeyhole className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="flex-1">
              {t(
                "اشتراکت تموم شده؛ اطلاعاتت محفوظ است. برای ادامه فعالیت اشتراک را فعال کن.",
                "Your subscription ended; your data is safe. Activate a plan to continue making changes.",
              )}
            </span>
          </Link>
        )}

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
      <Modal
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        title={t("اعلان‌ها", "Notifications")}
      >
        {db.notifications.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("اعلانی نداری 🎈", "No notifications yet 🎈")}
          </p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {db.notifications.map((n) => (
              <div
                key={n.id}
                className={`rounded-xl border border-border p-3 ${n.read ? "opacity-60" : ""}`}
              >
                <p className="text-sm font-bold text-foreground">{n.title}</p>
                <p className="text-xs text-muted-foreground">{n.body}</p>
              </div>
            ))}
            <Button variant="secondary" onClick={ctx.markNotificationsRead}>
              {t("خواندن همه", "Mark all read")}
            </Button>
          </div>
        )}
      </Modal>

      {/* پاپ‌آپ نظرسنجی — همان فرمی که دکمه‌ی تنظیمات هم باز می‌کند. */}
      <FeedbackModal open={feedbackOpen} onDone={closeFeedback} />

      <Modal
        open={ctx.writeBlocked}
        onClose={ctx.clearWriteBlocked}
        title={t("اشتراک برای ادامه فعالیت", "Subscription required to continue")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-7 text-muted-foreground">
            {t(
              "اطلاعات قبلی‌ات همچنان قابل مشاهده و همگام‌سازی است؛ برای ثبت تغییر جدید اشتراکت را فعال کن.",
              "Your existing data remains visible and synced. Activate a plan to save new changes.",
            )}
          </p>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                ctx.clearWriteBlocked();
                navigate({ to: "/subscribe" });
              }}
            >
              {t("فعال کردن اشتراک", "Activate subscription")}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={ctx.clearWriteBlocked}>
              {t("فعلاً فقط مشاهده", "Keep viewing")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
