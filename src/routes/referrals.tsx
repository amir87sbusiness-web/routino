import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, Gift, RefreshCw, Share2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button, Card, Input } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import {
  claimReferralCode,
  ensureReferralSummaryCached,
  normalizeReferralCode,
  queueReferralSummaryRefresh,
  readCachedReferralSummary,
  type ReferralSummary,
} from "@/lib/api/referrals";
import { shareReferralCode } from "@/lib/referral-share";
import { faNum } from "@/lib/dates";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/referrals")({
  component: () => (
    <AppShell>
      <ReferralsPage />
    </AppShell>
  ),
});

function errorCopy(error: unknown, t: (fa: string, en: string) => string): string {
  const code = error instanceof ApiError ? error.code : "offline";
  const messages: Record<string, [string, string]> = {
    invalid_referral_code: ["این کد دعوت معتبر نیست.", "This referral code is not valid."],
    self_referral: ["نمی‌تونی کد خودت رو وارد کنی.", "You cannot use your own code."],
    referral_already_claimed: [
      "قبلاً یک کد دعوت ثبت کرده‌ای.",
      "You already claimed a referral code.",
    ],
    referral_not_eligible: [
      "این حساب امکان ثبت کد دعوت ندارد.",
      "This account cannot claim a referral code.",
    ],
    offline: ["اتصال اینترنت رو بررسی کن و دوباره تلاش کن.", "Check your connection and retry."],
  };
  const copy = messages[code] ?? messages.offline!;
  return t(copy[0], copy[1]);
}

function ReferralsPage() {
  const ctx = useAppMaybe();
  const userId = ctx?.db?.auth?.userId;
  const [summary, setSummary] = useState<ReferralSummary | null>(() =>
    userId ? readCachedReferralSummary(userId) : null,
  );
  const [loading, setLoading] = useState(() => !summary);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [claimCode, setClaimCode] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const requestedFor = useRef<string | null>(null);

  const load = async (forceRefresh = false) => {
    if (!ctx || !userId) return;
    if (forceRefresh) setRefreshBusy(true);
    else setLoading(true);
    setLoadError(null);
    try {
      setSummary(
        forceRefresh
          ? await queueReferralSummaryRefresh(userId)
          : await ensureReferralSummaryCached(userId),
      );
    } catch (error) {
      if (!forceRefresh) setLoadError(errorCopy(error, ctx.t));
      if (summary && !forceRefresh) {
        toast.error(
          ctx.t(
            "به‌روزرسانی انجام نشد؛ اطلاعات ذخیره‌شده نمایش داده می‌شود.",
            "Could not refresh; showing saved information.",
          ),
        );
      }
    } finally {
      setLoading(false);
      setRefreshBusy(false);
    }
  };

  useEffect(() => {
    if (!userId || requestedFor.current === userId) return;
    requestedFor.current = userId;
    const cached = readCachedReferralSummary(userId);
    setSummary(cached);
    setLoading(!cached);
    setLoadError(null);
    if (cached) return;
    void load();
    // The first successful response is cached per account. Future visits are
    // local-only; refreshing server counters is always an explicit action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!ctx || !userId) return null;
  const { t, lang } = ctx;

  const copyCode = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.referralCode);
      toast.success(t("کد دعوت کپی شد", "Referral code copied"));
    } catch {
      toast.error(t("کپی کد انجام نشد", "Could not copy the code"));
    }
  };

  const share = async () => {
    if (!summary || shareBusy) return;
    setShareBusy(true);
    try {
      const result = await shareReferralCode(
        summary.referralCode,
        t(
          "با کد من به روتینو بیا؛ بعد از خرید اولین اشتراک، هر دومون یک هفته هدیه می‌گیریم.",
          "Join Routino with my code. After your first subscription purchase, we both get a free week.",
        ),
      );
      if (result === "copied") toast.success(t("متن دعوت کپی شد", "Invitation copied"));
    } catch {
      toast.error(t("اشتراک‌گذاری انجام نشد", "Could not share the invitation"));
    } finally {
      setShareBusy(false);
    }
  };

  const submitClaim = async () => {
    if (claimBusy || claimCode.length !== 6) return;
    setClaimBusy(true);
    setClaimError(null);
    try {
      setSummary(await claimReferralCode(claimCode, userId));
      toast.success(t("کد دعوت ثبت شد", "Referral code claimed"));
    } catch (error) {
      setClaimError(errorCopy(error, t));
    } finally {
      setClaimBusy(false);
    }
  };

  const claimState = summary?.claimState;

  return (
    <div className="page-stagger mx-auto flex max-w-xl flex-col gap-4 pb-20 lg:pb-0">
      <section className="overflow-hidden rounded-3xl border border-primary/20 bg-primary-soft px-5 py-7 text-foreground shadow-sm sm:px-8 sm:py-9">
        <Gift className="mb-5 h-9 w-9 text-primary" aria-hidden="true" />
        <h1 className="whitespace-nowrap text-[clamp(1.05rem,5.4vw,1.5rem)] font-black leading-8 sm:text-3xl sm:leading-10">
          {t("یک هفته هدیه با هر دعوت موفق", "A free week per referral")}
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-foreground">
          {t("تو و دوستت، هر کدام یک هفته رایگان.", "You and your friend each get one free week.")}
        </p>
        <p className="mt-1.5 whitespace-nowrap text-[10px] leading-5 text-muted-foreground sm:text-[11px]">
          {t(
            "دوستت با کد تو ثبت‌نام کند و اولین اشتراکش را بخرد.",
            "Successful after your friend's first subscription purchase.",
          )}
        </p>
      </section>

      <Card className="text-center">
        <p className="text-xs font-bold text-muted-foreground">{t("کد دعوت تو", "Your code")}</p>
        <div
          className="mt-3 font-mono text-3xl font-black tracking-[0.28em] text-foreground"
          dir="ltr"
        >
          {summary?.referralCode ?? "------"}
        </div>
        {summary ? (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button className="min-h-11" variant="secondary" onClick={() => void copyCode()}>
              <Copy className="h-4 w-4" aria-hidden="true" /> {t("کپی کد", "Copy code")}
            </Button>
            <Button className="min-h-11" disabled={shareBusy} onClick={() => void share()}>
              <Share2 className="h-4 w-4" aria-hidden="true" /> {t("اشتراک‌گذاری", "Share")}
            </Button>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl bg-muted/60 px-4 py-4">
            <p
              className="text-sm leading-7 text-muted-foreground"
              role={loadError ? "alert" : undefined}
            >
              {loading
                ? t("در حال آماده‌سازی کد دعوت…", "Preparing your referral code…")
                : t(
                    "کد دعوتت با اولین اتصال ساخته می‌شه و بعد همیشه روی همین دستگاه در دسترس می‌مونه.",
                    "Your referral code is created on the first connection, then stays available on this device.",
                  )}
            </p>
            {!loading && (
              <Button className="mt-3 min-h-11" onClick={() => void load()}>
                {t("دریافت کد", "Get code")}
              </Button>
            )}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3" aria-label={t("آمار دعوت", "Referral stats")}>
        <Card>
          <Users className="mb-3 h-5 w-5 text-primary" aria-hidden="true" />
          <p className="text-2xl font-black tabular-nums text-foreground">
            {summary ? faNum(summary.successfulInvites, lang) : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("دعوت موفق", "Successful referrals")}
          </p>
        </Card>
        <Card>
          <Gift className="mb-3 h-5 w-5 text-primary" aria-hidden="true" />
          <p className="text-2xl font-black tabular-nums text-foreground">
            {summary ? faNum(summary.earnedDays, lang) : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("روز هدیه", "Gift days")}</p>
        </Card>
      </div>

      {summary && (
        <div className="flex justify-center">
          <Button className="min-h-11" variant="ghost" onClick={() => void load(true)}>
            <RefreshCw
              className={`h-4 w-4 ${refreshBusy ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {refreshBusy
              ? t("در حال دریافت آمار…", "Fetching stats…")
              : t("به‌روزرسانی آمار", "Refresh stats")}
          </Button>
        </div>
      )}

      {claimState?.status === "eligible" && (
        <Card>
          <h2 className="text-sm font-black text-foreground">
            {t("کد دعوت یک دوست رو داری؟", "Have a friend's referral code?")}
          </h2>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            {t(
              "تا قبل از اولین خرید می‌تونی یک کد رو برای همیشه ثبت کنی.",
              "You can claim one code before your first purchase.",
            )}
          </p>
          <form
            className="mt-4 flex gap-2"
            dir="ltr"
            onSubmit={(event) => {
              event.preventDefault();
              void submitClaim();
            }}
          >
            <Input
              className="text-center font-mono font-black tracking-[0.2em] uppercase"
              aria-label={t("کد دعوت دوست", "Friend's referral code")}
              placeholder="ABCDEF"
              value={claimCode}
              onChange={(event) => {
                setClaimCode(normalizeReferralCode(event.target.value));
                setClaimError(null);
              }}
            />
            <Button
              type="submit"
              className="min-h-11"
              disabled={claimBusy || claimCode.length !== 6}
            >
              {claimBusy ? "…" : t("ثبت", "Claim")}
            </Button>
          </form>
          {claimError && (
            <p className="mt-2 text-xs font-medium text-destructive" role="alert">
              {claimError}
            </p>
          )}
        </Card>
      )}

      {claimState?.status === "claimed" && (
        <Card className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Check className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="text-sm font-bold text-foreground">
            {t(
              "کد دعوتت ثبت شده و با اولین خرید اعمال می‌شه.",
              "Your referral code is saved and will apply to your first purchase.",
            )}
          </p>
        </Card>
      )}
    </div>
  );
}
