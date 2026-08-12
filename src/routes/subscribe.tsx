/**
 * Paywall / checkout page.
 *
 * Everything money-related is server-authoritative: plans come from
 * `GET /v1/plans`, discount codes are validated by `POST /v1/payments/quote`,
 * and `POST /v1/payments/checkout` returns the gateway URL. The client never
 * computes a price it expects to be charged — the percentages here are for
 * display only; the server re-computes the final amount at checkout.
 */
import { Capacitor } from "@capacitor/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BadgeCheck, LogIn, ShieldAlert, Tag, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input, Logo } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { entitlementToSubscription } from "@/lib/api/auth";
import { checkout, fetchPlans, fetchQuote, type ServerPlan } from "@/lib/api/payments";
import { faNum, formatDate, dateKey } from "@/lib/dates";
import { subscriptionActive } from "@/lib/logic";
import { PLANS } from "@/lib/presets";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/subscribe")({
  component: SubscribePage,
});

// ═══════════════ TEST-ONLY — بعداً حذف شود ═══════════════
// دکمه‌ی «تمدید تستی» که بدون پرداخت، اشتراک محلی می‌دهد تا بتوانی بقیه‌ی اپ را
// تست کنی. دکمه‌ی پرداخت واقعی (زیبال/درگاه) دست‌نخورده کنارش می‌ماند.
// برای حذف: این ثابت را false کن یا بلاکِ نشان‌دارِ TEST-ONLY در JSX را پاک کن.
const TEST_GRANT_BUTTON = false;

/** Bundled catalog as a fallback so the page can RENDER offline — buying still
 * needs the server, and the button says so. */
const FALLBACK_PLANS: ServerPlan[] = PLANS.map((p) => ({
  id: p.id,
  nameFa: p.nameFa,
  nameEn: p.nameEn,
  months: p.months,
  price: p.price,
}));

function SubscribePage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<ServerPlan[]>(FALLBACK_PLANS);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<string>("m3");
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<{ code: string; percent: number } | null>(null);
  const [codeError, setCodeError] = useState("");
  const [checking, setChecking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [freeSuccess, setFreeSuccess] = useState(false);

  // Server catalog. Failure keeps the bundled fallback and flags offline mode.
  useEffect(() => {
    let cancelled = false;
    fetchPlans()
      .then((res) => {
        if (cancelled || !res.plans.length) return;
        setPlans(res.plans);
        setOffline(false);
        // اگر پلنِ پیش‌فرض در فهرست واقعی سرور نبود، به یک پلن معتبر برگرد؛ وگرنه
        // دکمه‌ی پرداخت روی چیزی می‌ماند که سرور نمی‌شناسد و خرید با خطا رد می‌شود.
        setSelected((cur) => (res.plans.some((p) => p.id === cur) ? cur : (res.plans[1] ?? res.plans[0]).id));
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ctx?.db) return null;
  const { db, update, t, lang, cal } = ctx;

  const active = subscriptionActive(db);

  /** Display-only. The charged amount is recomputed server-side at checkout. */
  const priceOf = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return 0;
    let price = plan.price;
    if (appliedCode) price = Math.round((price * (100 - appliedCode.percent)) / 100);
    return price;
  };

  const explainReason = (reason?: string): string => {
    switch (reason) {
      case "expired":
        return t("این کد منقضی شده.", "This code has expired.");
      case "exhausted":
        return t("ظرفیت این کد تمام شده.", "This code has been fully used.");
      case "already_used":
        return t("قبلاً از این کد استفاده کردی.", "You have already used this code.");
      case "other_user":
        return t("این کد مخصوص حساب دیگه‌ایه.", "This code belongs to another account.");
      case "inactive":
      case "unknown":
      default:
        return t("کد تخفیف معتبر نیست.", "Invalid discount code.");
    }
  };

  const applyCode = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setChecking(true);
    setCodeError("");
    try {
      const res = await fetchQuote(selected, code);
      if (res.discount.valid && res.discount.code) {
        setAppliedCode({ code: res.discount.code, percent: res.discount.percent });
      } else {
        setAppliedCode(null);
        setCodeError(explainReason(res.discount.reason));
      }
    } catch (err) {
      setAppliedCode(null);
      if (err instanceof ApiError && err.offline) {
        setCodeError(t("برای بررسی کد به اینترنت نیاز داری.", "Checking the code needs internet."));
      } else if (err instanceof ApiError && err.status === 401) {
        setNeedsLogin(true);
      } else {
        setCodeError(t("بررسی کد ناموفق بود. دوباره تلاش کن.", "Could not check the code. Try again."));
      }
    } finally {
      setChecking(false);
    }
  };

  const pay = async () => {
    setPaying(true);
    setPayError("");
    setNeedsLogin(false);
    try {
      const platform = Capacitor.getPlatform() as "web" | "android" | "ios";
      const res = await checkout(selected, appliedCode?.code, platform);

      if (res.free && res.entitlement) {
        // 100% discount: granted server-side without a gateway round-trip.
        const sub = entitlementToSubscription(res.entitlement);
        if (sub) {
          update((d) => ({ ...d, subscription: sub, meta: { ...d.meta, tampered: false } }));
        }
        setFreeSuccess(true);
        setTimeout(() => navigate({ to: "/" }), 1500);
        return;
      }

      if (res.paymentUrl) {
        // Off to the gateway. The callback brings the user back to /pay/result.
        window.location.href = res.paymentUrl;
        return;
      }
      setPayError(t("شروع پرداخت ناموفق بود. دوباره تلاش کن.", "Could not start the payment. Try again."));
    } catch (err) {
      if (err instanceof ApiError && err.offline) {
        setPayError(t("برای خرید به اینترنت نیاز داری.", "Buying needs an internet connection."));
      } else if (err instanceof ApiError && (err.status === 401 || err.code === "not_signed_in")) {
        // Signed in locally but no server session (pre-backend account).
        setNeedsLogin(true);
      } else if (err instanceof ApiError && err.code === "rate_limited") {
        setPayError(t("تلاش زیاد بود؛ کمی بعد دوباره امتحان کن.", "Too many attempts; try again soon."));
      } else if (err instanceof ApiError && err.code === "psp_failed") {
        setPayError(t("درگاه پرداخت در دسترس نیست. چند دقیقه دیگر تلاش کن.", "The gateway is unavailable. Try again shortly."));
      } else {
        setPayError(t("یه مشکلی پیش اومد. دوباره تلاش کن.", "Something went wrong. Try again."));
      }
    } finally {
      setPaying(false);
    }
  };

  // TEST-ONLY: اشتراک محلی بدون پرداخت. مبلغی جابه‌جا نمی‌شود و سرور خبردار نمی‌شود.
  const testGrant = () => {
    const plan = plans.find((p) => p.id === selected) ?? plans[0];
    const now = Date.now();
    const base = db.subscription && db.subscription.expiresAt > now ? db.subscription.expiresAt : now;
    update((d) => ({
      ...d,
      subscription: {
        planId: plan?.id ?? "m3",
        startedAt: now,
        expiresAt: base + (plan?.months ?? 3) * 30 * 86_400_000,
        trial: false,
      },
      meta: { ...d.meta, tampered: false },
    }));
    navigate({ to: "/" });
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 bg-background px-5 py-screen-safe">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="h-14 w-14" />
        <h1 className="text-xl font-black text-foreground">{t("اشتراک نوینو", "Novino Subscription")}</h1>
        {db.meta.tampered && (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
            <ShieldAlert className="h-4 w-4" />
            {t(
              "تغییر ساعت دستگاه شناسایی شد؛ برای ادامه باید اشتراک را تمدید کنی.",
              "Clock tampering detected; renew your subscription to continue.",
            )}
          </div>
        )}
        {active && db.subscription ? (
          <p className="text-xs text-muted-foreground">
            {t("اشتراک فعال تا:", "Active until:")}{" "}
            <b className="text-foreground">
              {formatDate(dateKey(new Date(db.subscription.expiresAt)), cal, lang)}
            </b>
            {db.subscription.trial ? t(" (دوره آزمایشی)", " (trial)") : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t(
              "برای استفاده از نوینو به اشتراک فعال نیاز داری.",
              "You need an active subscription to use Novino.",
            )}
          </p>
        )}
        {offline && (
          <div className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-[11px] font-medium text-muted-foreground">
            <WifiOff className="h-3.5 w-3.5" />
            {t("سرور در دسترس نیست؛ برای خرید به اینترنت نیاز داری.", "Server unreachable; buying needs internet.")}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {plans.map((p) => {
          const basePrice = p.price;
          const final = priceOf(p.id);
          return (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`flex items-center justify-between rounded-2xl border-2 p-4 text-start transition-all ${
                selected === p.id ? "border-primary bg-primary-soft" : "border-border bg-card"
              }`}
            >
              <div>
                <p className="text-sm font-bold text-foreground">{lang === "fa" ? p.nameFa : p.nameEn}</p>
                <p className="text-[10px] text-muted-foreground">
                  {faNum(p.months, lang)} {t("ماه دسترسی کامل", "months full access")}
                </p>
              </div>
              <div className="text-end">
                {final < basePrice && (
                  <p className="text-[10px] text-muted-foreground line-through">
                    {faNum(basePrice.toLocaleString("en-US"), lang)}
                  </p>
                )}
                <p className="text-sm font-black text-foreground">
                  {faNum(final.toLocaleString("en-US"), lang)}{" "}
                  <span className="text-[10px] font-normal">{t("تومان", "Toman")}</span>
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            dir="ltr"
            placeholder={t("کد تخفیف", "Discount code")}
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void applyCode()}
            className="text-center uppercase"
          />
          <Button variant="secondary" onClick={() => void applyCode()} disabled={checking}>
            <Tag className="h-4 w-4" />
            {checking ? t("بررسی…", "Checking…") : t("اعمال", "Apply")}
          </Button>
        </div>
        {codeError && <p className="text-xs text-destructive">{codeError}</p>}
        {appliedCode && (
          <p className="text-xs font-medium text-success">
            ✓ {t(`کد ${appliedCode.code} اعمال شد`, `Code ${appliedCode.code} applied`)} (
            {faNum(appliedCode.percent, lang)}٪)
          </p>
        )}
      </div>

      {freeSuccess ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-success/10 p-5 text-center">
          <BadgeCheck className="h-8 w-8 text-success" />
          <p className="text-sm font-bold text-foreground">
            {t("اشتراکت فعال شد! 🎉", "Your subscription is active! 🎉")}
          </p>
        </div>
      ) : needsLogin ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-secondary p-5 text-center">
          <LogIn className="h-6 w-6 text-muted-foreground" />
          <p className="text-xs leading-6 text-muted-foreground">
            {t(
              "برای خرید باید با کد پیامکی وارد شوی تا خریدت به شماره‌ات وصل شود.",
              "To buy, sign in with an SMS code so the purchase is tied to your number.",
            )}
          </p>
          <Button onClick={() => navigate({ to: "/auth" })} className="w-full">
            {t("ورود با شماره موبایل", "Sign in with phone")}
          </Button>
        </div>
      ) : (
        <>
          <Button onClick={() => void pay()} disabled={paying} className="py-3.5 text-base">
            {paying
              ? t("در حال انتقال به درگاه…", "Opening the gateway…")
              : t("پرداخت و فعال‌سازی", "Pay & activate")}
          </Button>
          {payError && <p className="text-center text-xs text-destructive">{payError}</p>}
        </>
      )}

      <p className="text-center text-[10px] leading-5 text-muted-foreground">
        {t(
          "پرداخت از طریق درگاه امن انجام می‌شود و اشتراک بلافاصله بعد از پرداخت فعال می‌شود.",
          "Payment goes through a secure gateway and the subscription activates immediately.",
        )}
      </p>

      {/* ═══ TEST-ONLY: تمدید بدون پرداخت — این بلاک را برای حذف پاک کن ═══ */}
      {TEST_GRANT_BUTTON && (
        <button
          type="button"
          onClick={testGrant}
          className="rounded-xl border border-dashed border-muted-foreground/40 py-2.5 text-xs text-muted-foreground"
        >
          🧪 {t("تمدید تستی (بدون پرداخت)", "Test activate (no payment)")}
        </button>
      )}
      {/* ═══ پایان TEST-ONLY ═══ */}

      {active && (
        <Button variant="ghost" onClick={() => navigate({ to: "/" })}>
          {t("بازگشت به برنامه", "Back to app")}
        </Button>
      )}
    </div>
  );
}
