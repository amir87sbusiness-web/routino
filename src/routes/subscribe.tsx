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
import { Browser } from "@capacitor/browser";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BadgeCheck, LogIn, ShieldAlert, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Logo } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { entitlementToSubscription } from "@/lib/api/auth";
import {
  checkoutWithProviderBusyRetry,
  fetchPlans,
  fetchQuote,
  type ServerPlan,
} from "@/lib/api/payments";
import { faNum, formatDate, dateKey } from "@/lib/dates";
import { subscriptionActive } from "@/lib/logic";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/subscribe")({
  component: SubscribePage,
});

const PLAN_PRESENTATION = [
  { id: "m1", nameFa: "یک‌ماهه", nameEn: "1 Month", months: 1 },
  { id: "m3", nameFa: "سه‌ماهه", nameEn: "3 Months", months: 3 },
  { id: "m6", nameFa: "شش‌ماهه", nameEn: "6 Months", months: 6 },
] as const;

function SubscribePage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  // Only presentation metadata is bundled. Money remains server-authoritative,
  // so the cards stay stable while just their numeric price areas load.
  const [plans, setPlans] = useState<ServerPlan[]>([]);
  const [offline, setOffline] = useState(false);
  const [selected, setSelected] = useState<string>("m3");
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<{
    code: string;
    finalPriceByPlan: Record<string, number>;
  } | null>(null);
  const [codeError, setCodeError] = useState("");
  const [checking, setChecking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [freeSuccess, setFreeSuccess] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const codeCheckInFlight = useRef(false);
  const paymentInFlight = useRef(false);
  const paymentAttempt = useRef<{ id: string; key: string } | null>(null);
  const paymentAbort = useRef<AbortController | null>(null);

  // Server catalog is the only source of prices. If it is unavailable, do not
  // substitute bundled numbers: showing no price is safer than showing a stale
  // price on a checkout screen.
  useEffect(() => {
    let cancelled = false;
    fetchPlans()
      .then((res) => {
        if (cancelled) return;
        if (!res.plans.length) {
          setOffline(true);
          return;
        }
        setPlans(res.plans);
        setOffline(false);
        // اگر پلنِ پیش‌فرض در فهرست واقعی سرور نبود، به یک پلن معتبر برگرد؛ وگرنه
        // دکمه‌ی پرداخت روی چیزی می‌ماند که سرور نمی‌شناسد و خرید با خطا رد می‌شود.
        setSelected((cur) => {
          if (res.plans.some((p) => p.id === cur)) return cur;
          return (
            PLAN_PRESENTATION.find((item) => res.plans.some((plan) => plan.id === item.id))?.id ??
            res.plans[0].id
          );
        });
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      paymentAbort.current?.abort();
      paymentAbort.current = null;
    },
    [],
  );

  // Display clock only. It never talks to the server.
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!ctx?.db) return null;
  const { db, applyEntitlement, t, lang, cal } = ctx;

  const active = subscriptionActive(db);
  const trialStart = db.subscription?.trial ? db.subscription.startedAt : null;
  const offerElapsed = trialStart == null ? -1 : clock - trialStart;
  const offerStage =
    offerElapsed >= 0 && offerElapsed < 3 * 86_400_000
      ? 1
      : offerElapsed >= 3 * 86_400_000 && offerElapsed < 7 * 86_400_000
        ? 2
        : null;
  const offerUntil = offerStage && trialStart ? trialStart + 7 * 86_400_000 : null;
  const offerSecondsLeft = offerUntil ? Math.max(0, Math.ceil((offerUntil - clock) / 1_000)) : 0;
  const offerDaysLeft = Math.floor(offerSecondsLeft / 86_400);
  const offerTimeLeft = [
    Math.floor((offerSecondsLeft % 86_400) / 3_600),
    Math.floor((offerSecondsLeft % 3_600) / 60),
    offerSecondsLeft % 60,
  ]
    .map((part) => faNum(String(part).padStart(2, "0"), lang))
    .join(":");
  const offerPrice = (plan: ServerPlan): number | null => {
    if (!offerStage || !plan.offer) return null;
    const rule = offerStage === 1 ? plan.offer.first : plan.offer.second;
    return Math.max(
      0,
      rule.kind === "fixed"
        ? plan.price - rule.value
        : Math.round((plan.price * (100 - rule.value)) / 100),
    );
  };
  /** Display-only. The charged amount is recomputed server-side at checkout. */
  const priceOf = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return 0;
    return Math.min(
      appliedCode?.finalPriceByPlan[planId] ?? plan.price,
      offerPrice(plan) ?? plan.price,
    );
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
      case "not_applicable":
        return t("این کد برای این پلن نیست.", "This code does not apply to this plan.");
      case "inactive":
      case "unknown":
      default:
        return t("کد تخفیف معتبر نیست.", "Invalid discount code.");
    }
  };

  const applyCode = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code || !plans.length || codeCheckInFlight.current) return;
    if (appliedCode?.code === code) return;
    codeCheckInFlight.current = true;
    setChecking(true);
    setCodeError("");
    try {
      const finalPriceByPlan: Record<string, number> = {};
      let canonicalCode = code;
      let firstReason: string | undefined;

      // At most three sequential checks keep peak server load to one request.
      // A globally invalid code stops immediately; only plan-specific misses
      // continue because the same code can still be valid for another plan.
      for (const plan of plans) {
        const res = await fetchQuote(plan.id, code);
        if (res.discount.valid && res.discount.code) {
          canonicalCode = res.discount.code;
          finalPriceByPlan[plan.id] = res.quote.finalToman;
          continue;
        }
        firstReason ??= res.discount.reason;
        if (res.discount.reason !== "not_applicable") break;
      }

      if (Object.keys(finalPriceByPlan).length) {
        setAppliedCode({ code: canonicalCode, finalPriceByPlan });
      } else {
        setAppliedCode(null);
        setCodeError(explainReason(firstReason));
      }
    } catch (err) {
      setAppliedCode(null);
      if (err instanceof ApiError && err.offline) {
        setCodeError(t("برای بررسی کد به اینترنت نیاز داری.", "Checking the code needs internet."));
      } else if (err instanceof ApiError && err.status === 401) {
        setNeedsLogin(true);
      } else {
        setCodeError(
          t("بررسی کد ناموفق بود. دوباره تلاش کن.", "Could not check the code. Try again."),
        );
      }
    } finally {
      codeCheckInFlight.current = false;
      setChecking(false);
    }
  };

  const pay = async () => {
    if (!plans.some((p) => p.id === selected)) return;
    // React state does not disable the button until the next render. This ref is
    // synchronous, so a double click cannot create two checkout requests.
    if (paymentInFlight.current) return;
    paymentInFlight.current = true;
    setPaying(true);
    setPayError("");
    setNeedsLogin(false);
    const controller = new AbortController();
    paymentAbort.current = controller;
    try {
      const platform = Capacitor.getPlatform() as "web" | "android" | "ios";
      const discountCode =
        appliedCode?.finalPriceByPlan[selected] != null ? appliedCode.code : undefined;
      const attemptKey = JSON.stringify([selected, discountCode ?? null, platform]);
      if (!paymentAttempt.current || paymentAttempt.current.key !== attemptKey) {
        paymentAttempt.current = { id: crypto.randomUUID(), key: attemptKey };
      }
      const res = await checkoutWithProviderBusyRetry(
        selected,
        discountCode,
        platform,
        paymentAttempt.current.id,
        controller.signal,
      );

      if (res.free && res.entitlement) {
        paymentAttempt.current = null;
        // 100% discount: granted server-side without a gateway round-trip.
        const sub = entitlementToSubscription(res.entitlement);
        if (sub) {
          applyEntitlement(sub);
        }
        setFreeSuccess(true);
        setTimeout(() => navigate({ to: "/" }), 1500);
        return;
      }

      if (res.paymentUrl) {
        // Off to the gateway. The callback brings the user back to /pay/result.
        if (Capacitor.isNativePlatform()) {
          await Browser.open({ url: res.paymentUrl });
        } else {
          window.location.href = res.paymentUrl;
        }
        return;
      }
      paymentAttempt.current = null;
      setPayError(
        t("شروع پرداخت ناموفق بود. دوباره تلاش کن.", "Could not start the payment. Try again."),
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const retryable =
        err instanceof ApiError &&
        (err.offline ||
          err.code === "provider_busy" ||
          err.code === "payment_network_timeout" ||
          err.code === "payment_provider_unavailable" ||
          err.code === "duplicate_payment_attempt");
      if (!retryable) paymentAttempt.current = null;

      if (err instanceof ApiError && err.offline) {
        setPayError(t("برای خرید به اینترنت نیاز داری.", "Buying needs an internet connection."));
      } else if (err instanceof ApiError && (err.status === 401 || err.code === "not_signed_in")) {
        // Signed in locally but no server session (pre-backend account).
        setNeedsLogin(true);
      } else if (err instanceof ApiError && err.code === "rate_limited") {
        setPayError(
          t("تلاش زیاد بود؛ کمی بعد دوباره امتحان کن.", "Too many attempts; try again soon."),
        );
      } else if (err instanceof ApiError && err.code === "duplicate_payment_attempt") {
        setPayError(
          t(
            "این تلاش پرداخت قبلاً ثبت شده؛ چند لحظه صبر کن و دوباره وضعیت را بررسی کن.",
            "This payment attempt is already registered. Wait a moment and check again.",
          ),
        );
      } else if (err instanceof ApiError && err.code === "provider_busy") {
        setPayError(
          t(
            "درگاه شلوغ است؛ چند لحظه دیگر دوباره امتحان کن.",
            "The gateway is busy. Try again in a moment.",
          ),
        );
      } else if (
        err instanceof ApiError &&
        (err.code === "psp_failed" || err.code === "payment_provider_unavailable")
      ) {
        setPayError(
          t(
            "درگاه پرداخت در دسترس نیست. چند دقیقه دیگر تلاش کن.",
            "The gateway is unavailable. Try again shortly.",
          ),
        );
      } else if (err instanceof ApiError && err.code === "payment_request_unknown") {
        setPayError(
          t(
            "پاسخ زرین‌پال نامشخص بود و درخواست خودکار تکرار نشد. چند دقیقه بعد دوباره تلاش کن.",
            "ZarinPal's response was uncertain and was not retried automatically. Try again later.",
          ),
        );
      } else {
        setPayError(t("یه مشکلی پیش اومد. دوباره تلاش کن.", "Something went wrong. Try again."));
      }
    } finally {
      if (paymentAbort.current === controller) {
        paymentAbort.current = null;
        paymentInFlight.current = false;
        setPaying(false);
      }
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-background px-5 py-screen-safe">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="h-12 w-12" />
        <h1 className="text-xl font-black text-foreground">
          {t("اشتراک روتینو", "Routino Subscription")}
        </h1>
        {db.meta.tampered && (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
            <ShieldAlert className="h-4 w-4" />
            {t(
              "ساعت دستگاه نیاز به بررسی آنلاین دارد؛ به اینترنت وصل شو تا وضعیت اشتراک دوباره تأیید شود.",
              "Your device clock needs online verification. Connect to confirm your subscription status.",
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
              "اطلاعات قبلی‌ات قابل مشاهده است؛ اشتراک فعال امکان ثبت و تغییر دوباره را باز می‌کند.",
              "Your existing data stays visible. An active subscription restores creating and editing.",
            )}
          </p>
        )}
        {offline && (
          <div className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-[11px] font-medium text-muted-foreground">
            <WifiOff className="h-3.5 w-3.5" />
            {t(
              "سرور در دسترس نیست؛ برای خرید به اینترنت نیاز داری.",
              "Server unreachable; buying needs internet.",
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {offerUntil &&
          plans.some(
            (plan) =>
              plan.offer &&
              (offerStage === 1 ? plan.offer.first.value : plan.offer.second.value) > 0,
          ) && (
            <p className="text-center text-xs font-medium text-primary">
              {t("خرید اول", "First purchase")}
              {" · "}
              {t("زمان باقی‌مانده: ", "Time left: ")}
              {faNum(offerDaysLeft, lang)} {t("روز و ", "days and ")}
              <span dir="ltr" className="inline-block tabular-nums">
                {offerTimeLeft}
              </span>
            </p>
          )}
        {PLAN_PRESENTATION.map((presentation) => {
          const plan = plans.find((item) => item.id === presentation.id);
          const final = plan ? priceOf(plan.id) : null;
          const referencePrice = plan
            ? final != null && final < plan.price
              ? plan.price
              : plan.originalPrice != null && plan.originalPrice > plan.price
                ? plan.originalPrice
                : plan.price
            : null;
          return (
            <button
              key={presentation.id}
              type="button"
              data-plan-id={presentation.id}
              aria-pressed={selected === presentation.id}
              onClick={() => {
                setSelected(presentation.id);
                setCodeError("");
              }}
              className={`flex items-center justify-between rounded-2xl border p-4 text-start transition-colors ${
                selected === presentation.id
                  ? "border-primary bg-primary-soft"
                  : "border-border bg-card"
              }`}
            >
              <div>
                <p className="text-sm font-bold text-foreground">
                  {lang === "fa" ? presentation.nameFa : presentation.nameEn}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {faNum(presentation.months, lang)} {t("ماه دسترسی کامل", "months full access")}
                </p>
              </div>
              <div className="flex min-w-32 flex-col items-end text-end tabular-nums">
                {!plan && !offline ? (
                  <>
                    <span
                      data-price-loading="true"
                      className="h-5 w-24 animate-pulse rounded-md bg-secondary"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{t("در حال دریافت قیمت", "Loading price")}</span>
                  </>
                ) : plan && final != null ? (
                  <>
                    {referencePrice != null && final < referencePrice && (
                      <p className="text-[10px] text-muted-foreground line-through">
                        {faNum(referencePrice.toLocaleString("en-US"), lang)}
                      </p>
                    )}
                    {final < plan.price && (
                      <p className="text-[10px] text-primary">
                        {t("تخفیف: ", "Discount: ")}
                        {faNum((plan.price - final).toLocaleString("en-US"), lang)}{" "}
                        {t("تومان", "Toman")}
                      </p>
                    )}
                    <p className="text-sm font-black text-foreground">
                      {faNum(final.toLocaleString("en-US"), lang)}{" "}
                      <span className="text-[10px] font-normal">{t("تومان", "Toman")}</span>
                    </p>
                  </>
                ) : (
                  <span className="text-sm font-bold text-muted-foreground">—</span>
                )}
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
            onChange={(e) => {
              setCodeInput(e.target.value);
              if (e.target.value.trim().toUpperCase() !== appliedCode?.code) setAppliedCode(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void applyCode()}
            className="text-center uppercase"
            disabled={plans.length === 0}
          />
          <Button
            variant="secondary"
            onClick={() => void applyCode()}
            disabled={checking || plans.length === 0}
          >
            {checking ? t("بررسی…", "Checking…") : t("اعمال", "Apply")}
          </Button>
        </div>
        {codeError && <p className="text-xs text-destructive">{codeError}</p>}
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
          <Button
            onClick={() => void pay()}
            disabled={paying || plans.length === 0}
            className="py-3.5 text-base"
          >
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

      {active && (
        <Button variant="ghost" onClick={() => navigate({ to: "/" })}>
          {t("بازگشت به برنامه", "Back to app")}
        </Button>
      )}
    </div>
  );
}
