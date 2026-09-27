import { Link } from "@tanstack/react-router";
import { Check, ChevronLeft, Copy, Gift, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { ReferralSummary } from "@/lib/api/referrals";
import { faNum, type Lang } from "@/lib/dates";

export function ReferralSettingsCard({
  summary,
  lang,
  t,
}: {
  summary: ReferralSummary | null;
  lang: Lang;
  t: (fa: string, en: string) => string;
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.referralCode);
      setCopied(true);
      toast.success(t("کد دعوت کپی شد", "Referral code copied"));
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error(t("کپی کد انجام نشد", "Could not copy the code"));
    }
  };

  return (
    <section
      className="card-surface flex flex-col gap-3 p-4"
      aria-label={t("دعوت دوستان", "Invite friends")}
    >
      <Link to="/referrals" className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Gift className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-foreground">
            {t("دعوت دوستان", "Invite friends")}
          </span>
          <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">
            {t(
              "بعد از اولین خرید موفق دوستت، هر دوی شما ۷ روز اشتراک هدیه می‌گیرید.",
              "After your friend's first successful purchase, both of you get 7 free days.",
            )}
          </span>
        </span>
        <ChevronLeft
          className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-0 ltr:rotate-180"
          aria-hidden="true"
        />
      </Link>

      {summary && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <span className="text-[11px] font-bold text-muted-foreground">
              {t("کد دعوت", "Referral code")}
            </span>
            <span
              dir="ltr"
              className="font-mono text-base font-black tracking-[0.18em] text-foreground"
            >
              {summary.referralCode}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void copyCode()}
            className="flex items-center gap-1.5 rounded-xl bg-primary-soft px-3 text-xs font-bold text-primary"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? t("کپی شد", "Copied") : t("کپی", "Copy")}
          </button>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-secondary px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> {t("دعوت موفق", "Successful invites")}
            </span>
            <strong className="mt-1 block text-base text-foreground">
              {faNum(summary.successfulInvites, lang)}
            </strong>
          </div>
          <div className="rounded-xl bg-secondary px-3 py-2.5">
            <span className="text-[10px] font-bold text-muted-foreground">
              {t("روز هدیه", "Gift days")}
            </span>
            <strong className="mt-1 block text-base text-foreground">
              {faNum(summary.earnedDays, lang)}
            </strong>
          </div>
        </div>
      )}
    </section>
  );
}
