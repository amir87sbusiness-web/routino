/**
 * Landing page after the payment gateway.
 *
 * The gateway's callback page redirects here (web) or deep-links here
 * (android/ios) with `?paymentId=…&status=…`. The status in the URL is only a
 * hint for the first paint — the truth is `GET /v1/payments/:id`, which also
 * self-heals a payment whose callback never landed. While the payment is still
 * settling, this page polls.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BadgeCheck, CircleX, Hourglass, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Logo } from "@/components/ui";
import { entitlementToSubscription, hasSession } from "@/lib/api/auth";
import { fetchPayment, type PaymentStatus } from "@/lib/api/payments";
import { faNum } from "@/lib/dates";
import { useAppMaybe } from "@/state/app";

interface PayResultSearch {
  paymentId?: string;
  status?: string;
}

export const Route = createFileRoute("/pay/result")({
  validateSearch: (search: Record<string, unknown>): PayResultSearch => ({
    paymentId: typeof search.paymentId === "string" ? search.paymentId : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
  }),
  component: PayResultPage,
});

const POLL_MS = 2500;
const MAX_POLLS = 24; // ~1 minute, then we stop and let the user retry

function PayResultPage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const { paymentId, status: hintedStatus } = Route.useSearch();
  const [result, setResult] = useState<PaymentStatus | null>(null);
  const [state, setState] = useState<"loading" | "done" | "timeout" | "error">("loading");
  const polls = useRef(0);
  const applied = useRef(false);

  const applyEntitlement = ctx?.applyEntitlement;

  useEffect(() => {
    if (!paymentId || !hasSession()) {
      setState("error");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetchPayment(paymentId);
        if (cancelled) return;
        setResult(res);

        const s = res.payment.status;
        if (s === "paid" || s === "canceled" || s === "failed" || s === "verify_failed") {
          // Cache the server's answer locally — this is what opens the gate.
          if (s === "paid" && applyEntitlement && !applied.current) {
            applied.current = true;
            const sub = entitlementToSubscription(res.entitlement);
            if (sub) applyEntitlement(sub);
          }
          setState("done");
          return;
        }
        if (++polls.current >= MAX_POLLS) {
          setState("timeout");
          return;
        }
        timer = setTimeout(poll, POLL_MS);
      } catch {
        if (cancelled) return;
        if (++polls.current >= MAX_POLLS) setState("timeout");
        else timer = setTimeout(poll, POLL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [applyEntitlement, paymentId]);

  const t = ctx?.t ?? ((fa: string) => fa);
  const lang = ctx?.lang ?? "fa";
  const status = result?.payment.status ?? hintedStatus;

  const body = (() => {
    if (!paymentId || state === "error") {
      return (
        <ResultCard
          icon={<CircleX className="h-10 w-10 text-destructive" />}
          title={t("پرداختی پیدا نشد", "Payment not found")}
          detail={t(
            "اگر پرداختت انجام شده، از داخل برنامه وضعیت اشتراک را چک کن.",
            "If you did pay, check your subscription status inside the app.",
          )}
        />
      );
    }
    if (state === "loading" || (state !== "timeout" && !result)) {
      return (
        <ResultCard
          icon={<Hourglass className="h-10 w-10 animate-pulse text-primary" />}
          title={t("در حال بررسی پرداخت…", "Checking your payment…")}
          detail={t("چند لحظه صبر کن.", "Just a moment.")}
        />
      );
    }
    if (state === "timeout") {
      return (
        <ResultCard
          icon={<Hourglass className="h-10 w-10 text-primary" />}
          title={t("نتیجه هنوز نرسیده", "Result not in yet")}
          detail={t(
            "اگر پرداخت کرده‌ای نگران نباش؛ به محض تأیید، اشتراکت فعال می‌شود. کمی بعد دوباره سر بزن.",
            "If you paid, don't worry; your subscription activates once confirmed. Check back shortly.",
          )}
        />
      );
    }
    if (status === "paid") {
      return (
        <ResultCard
          icon={<BadgeCheck className="h-10 w-10 text-success" />}
          title={t("پرداخت موفق! 🎉", "Payment successful! 🎉")}
          detail={
            result
              ? t(
                  `اشتراک ${faNum(result.payment.months, lang)} ماهه فعال شد.` +
                    (result.payment.refNumber ? ` کد پیگیری: ${result.payment.refNumber}` : ""),
                  `Your ${result.payment.months}-month subscription is active.` +
                    (result.payment.refNumber ? ` Ref: ${result.payment.refNumber}` : ""),
                )
              : ""
          }
        />
      );
    }
    if (status === "canceled") {
      return (
        <ResultCard
          icon={<RotateCcw className="h-10 w-10 text-muted-foreground" />}
          title={t("پرداخت لغو شد", "Payment canceled")}
          detail={t("مبلغی از حسابت کم نشده.", "Nothing was charged.")}
        />
      );
    }
    return (
      <ResultCard
        icon={<CircleX className="h-10 w-10 text-destructive" />}
        title={t("پرداخت ناموفق بود", "Payment failed")}
        detail={t(
          "اگر مبلغی از حسابت کم شده، تا ۷۲ ساعت آینده برمی‌گردد.",
          "If you were charged, the amount returns within 72 hours.",
        )}
      />
    );
  })();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 bg-background px-5 py-screen-safe">
      <Logo className="h-14 w-14" />
      {body}
      <div className="flex w-full max-w-xs flex-col gap-2">
        {status === "paid" ? (
          <Button onClick={() => navigate({ to: "/" })} className="py-3">
            {t("شروع روتینو 🚀", "Start Routino 🚀")}
          </Button>
        ) : (
          <>
            <Button onClick={() => navigate({ to: "/subscribe" })} className="py-3">
              {t("تلاش دوباره", "Try again")}
            </Button>
            <Button variant="ghost" onClick={() => navigate({ to: "/" })}>
              {t("بازگشت به برنامه", "Back to app")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-3xl bg-card p-8 text-center shadow-sm">
      {icon}
      <p className="text-lg font-black text-foreground">{title}</p>
      {detail && <p className="text-xs leading-6 text-muted-foreground">{detail}</p>}
    </div>
  );
}
