import { useState } from "react";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { ArrowRight, Camera, Check, Copy, Send } from "lucide-react";
import { Button, Logo } from "@/components/ui";
import { faNum, type Lang } from "@/lib/dates";
import { LEGAL_INFO } from "@/lib/legal-info";

export interface CardTransferDetails {
  planName: string;
  months: number;
  basePrice: number;
  amount: number;
  discountCode: string | null;
  phone: string;
}

const CARD_NUMBER = "6219861490215695";
const CARD_OWNER = "امیر صالحی";

export function CardTransferPage({
  details,
  onBack,
  t,
  lang,
}: {
  details: CardTransferDetails;
  onBack: () => void;
  t: (fa: string, en: string) => string;
  lang: Lang;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");
  const money = (amount: number) =>
    `${faNum(amount.toLocaleString("en-US"), lang)} ${t("تومان", "Toman")}`;
  const discount = Math.max(0, details.basePrice - details.amount);
  const message = [
    "پرداخت کارت به کارت روتینو",
    `شماره تلفن: ${details.phone}`,
    `پلن: ${details.planName} (${details.months} ماه)`,
    `مبلغ: ${details.amount.toLocaleString("en-US")} تومان`,
    ...(details.discountCode ? [`کد تخفیف: ${details.discountCode}`] : []),
    ...(discount > 0 ? [`تخفیف: ${discount.toLocaleString("en-US")} تومان`] : []),
  ].join("\n");
  const copy = async (value: string, key: string) => {
    setError("");
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
    } catch {
      setError(
        t(
          "کپی خودکار انجام نشد؛ متن را نگه دار و دستی کپی کن.",
          "Automatic copy failed. Select the text and copy it manually.",
        ),
      );
    }
  };
  const openTelegram = () => {
    setError("");
    const url = `https://t.me/${LEGAL_INFO.telegram}?text=${encodeURIComponent(message)}`;
    if (Capacitor.isNativePlatform()) {
      void Browser.open({ url }).catch(() =>
        setError(
          t(
            "تلگرام باز نشد؛ آیدی routino_support را در تلگرام باز کن و مشخصات پرداخت را بفرست.",
            "Telegram did not open. Find routino_support in Telegram and send your payment details.",
          ),
        ),
      );
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };
  return (
    <div
      dir={lang === "fa" ? "rtl" : "ltr"}
      className="mx-auto flex w-full max-w-md flex-col gap-3 bg-background px-4 pt-safe pb-modal-safe"
    >
      <Button variant="ghost" onClick={onBack} className="self-start px-0 py-2">
        <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
        {t("بازگشت به روش پرداخت", "Back to payment methods")}
      </Button>
      <div className="flex items-center gap-3">
        <Logo className="h-8 w-8" />
        <div>
          <h1 className="text-lg font-black text-foreground">
            {t("پرداخت کارت به کارت", "Card transfer")}
          </h1>
        </div>
      </div>

      <section
        aria-label={t("مشخصات پرداخت", "Payment details")}
        className="rounded-2xl border border-border bg-card p-3"
      >
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
          <Camera className="h-4 w-4 text-primary" />
          {t("از این مشخصات اسکرین‌شات بگیر", "Take a screenshot of these details")}
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("پلن انتخابی", "Selected plan")}</dt>
            <dd className="font-bold text-foreground">{details.planName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("شماره موبایل", "Phone number")}</dt>
            <dd
              dir="ltr"
              className="select-text font-medium text-foreground"
              data-allow-copy="true"
            >
              {details.phone}
            </dd>
          </div>
          {discount > 0 && (
            <>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("مبلغ قبل از تخفیف", "Before discount")}
                </dt>
                <dd className="text-foreground">{money(details.basePrice)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  {t("تخفیف", "Discount")}
                  {details.discountCode ? ` (${details.discountCode})` : ""}
                </dt>
                <dd className="font-medium text-primary">{money(discount)}</dd>
              </div>
            </>
          )}
          {discount === 0 && details.discountCode && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("کد تخفیف", "Discount code")}</dt>
              <dd className="text-foreground">{details.discountCode}</dd>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <dt className="font-bold text-foreground">
              {t("مبلغ قابل پرداخت", "Amount to transfer")}
            </dt>
            <dd className="text-lg font-black text-foreground">{money(details.amount)}</dd>
          </div>
        </dl>
        <div className="mt-3 rounded-xl bg-secondary p-3">
          <p className="mb-1 text-xs text-muted-foreground">
            {t("شماره کارت مقصد", "Recipient card number")}
          </p>
          <input
            aria-label={t("شماره کارت", "Card number")}
            dir="ltr"
            readOnly
            value={CARD_NUMBER.replace(/(.{4})(?=.)/g, "$1 ")}
            onFocus={(e) => e.target.select()}
            className="w-full select-text border-0 bg-transparent text-center text-xl font-bold tracking-wide text-foreground outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-foreground">
              {t("به نام", "Account holder:")} {CARD_OWNER}
            </p>
            <Button
              variant="ghost"
              onClick={() => void copy(CARD_NUMBER, "card")}
              className="px-2 py-2 text-xs"
            >
              {copied === "card" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied === "card" ? t("کپی شد", "Copied") : t("کپی شماره کارت", "Copy card number")}
            </Button>
          </div>
        </div>
      </section>

      <p className="text-xs leading-6 text-muted-foreground">
        {t(
          "مبلغ بالا را کارت به کارت کن؛ سپس اسکرین‌شات این صفحه و رسید پرداخت را به پشتیبانی تلگرام بفرست.",
          "Transfer the amount above, then send a screenshot of this page and your transfer receipt to Telegram support.",
        )}
      </p>
      <p className="rounded-xl bg-primary-soft px-3 py-2 text-center text-xs font-medium leading-6 text-primary">
        {t(
          "فعال‌سازی در ساعات کاری کمتر از ۱ ساعت طول می‌کشد.",
          "Activation takes less than 1 hour during business hours.",
        )}
      </p>

      <div className="flex flex-col gap-2">
        <Button onClick={openTelegram} className="w-full">
          <Send className="h-4 w-4" />
          {t("ارسال به تلگرام", "Open Telegram")} <span dir="ltr">@{LEGAL_INFO.telegram}</span>
        </Button>
        {error && (
          <p role="alert" className="text-xs leading-6 text-destructive">
            {error}
          </p>
        )}
        {copied && (
          <span role="status" className="sr-only">
            {t("کپی شد", "Copied")}
          </span>
        )}
      </div>
    </div>
  );
}
