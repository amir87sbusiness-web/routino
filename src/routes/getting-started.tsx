import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Gift } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PersonalizationFlow } from "@/components/OnboardingFlow";
import { Button, Input, Logo } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { claimReferralCode, normalizeReferralCode } from "@/lib/api/referrals";
import { entitlementToSubscription, startTrial } from "@/lib/api/auth";
import {
  applyOnboardingHabits,
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
  type OnboardingDraft,
} from "@/lib/onboarding";
import { subscriptionActive } from "@/lib/logic";
import { activateGuide } from "@/lib/product-guide";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/getting-started")({
  component: GettingStartedPage,
});

function GettingStartedPage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const userId = ctx?.db?.auth?.userId;
  const [draft, setDraft] = useState<OnboardingDraft | null>(() => loadOnboardingDraft());
  const [pendingCompletion, setPendingCompletion] = useState<OnboardingDraft | null>(null);
  const [referralCode, setReferralCode] = useState("");
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);
  const completingRef = useRef(false);

  const ready = !!ctx?.db && !!ctx.db.auth && !!userId && !!draft && draft.ownerUserId === userId;

  useEffect(() => {
    if (!ctx?.db || ready) return;
    navigate({ to: "/" });
  }, [ctx?.db, navigate, ready]);

  useEffect(() => {
    if (!ctx?.db || !pendingCompletion || !subscriptionActive(ctx.db)) return;

    const accepted = ctx.update((current) => {
      const personalized = applyOnboardingHabits(current, pendingCompletion, ctx.lang);
      return {
        ...personalized,
        settings: { ...personalized.settings, onboarded: true },
      };
    });

    if (!accepted) {
      completingRef.current = false;
      setPendingCompletion(null);
      toast.error(
        ctx.t(
          "فعلاً نتونستیم عادت‌ها رو ذخیره کنیم. دوباره تلاش کن.",
          "We could not save your habits yet. Please try again.",
        ),
      );
      return;
    }

    clearOnboardingDraft();
    if (userId) activateGuide(userId);
    navigate({ to: "/" });
  }, [ctx, navigate, pendingCompletion, userId]);

  if (!ctx?.db || !draft || !ready) return null;
  const db = ctx.db;

  const finishReferralPrompt = () => {
    const next = { ...draft, referralPromptCompleted: true };
    setDraft(next);
    saveOnboardingDraft(next);
  };

  const submitReferral = async () => {
    if (referralBusy || referralCode.length !== 6) return;
    setReferralBusy(true);
    setReferralError(null);
    try {
      await claimReferralCode(referralCode, userId);
      finishReferralPrompt();
    } catch (error) {
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
        offline: [
          "اتصال اینترنت رو بررسی کن و دوباره تلاش کن.",
          "Check your connection and retry.",
        ],
      };
      const copy = messages[code] ?? messages.offline!;
      setReferralError(ctx.t(copy[0], copy[1]));
    } finally {
      setReferralBusy(false);
    }
  };

  const complete = async (completedDraft: OnboardingDraft) => {
    if (completingRef.current) return;
    completingRef.current = true;
    saveOnboardingDraft(completedDraft);

    if (subscriptionActive(db)) {
      setPendingCompletion(completedDraft);
      return;
    }

    try {
      const result = await startTrial();
      const subscription = entitlementToSubscription(result.entitlement);
      if (
        result.entitlement.status !== "active" ||
        result.entitlement.planId !== "trial" ||
        !subscription?.trial ||
        subscription.expiresAt <= Date.now()
      ) {
        throw new Error("trial_not_active");
      }
      ctx.applyEntitlement(subscription);
      setPendingCompletion(completedDraft);
    } catch {
      completingRef.current = false;
      toast.error(
        ctx.t(
          "شروع دوره رایگان انجام نشد. دوباره تلاش کن.",
          "The free trial could not be started. Please try again.",
        ),
      );
    }
  };

  return (
    <main className="min-h-screen overflow-hidden bg-background px-5 py-screen-safe">
      {!draft.referralPromptCompleted ? (
        <section className="mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-md flex-col justify-center">
          <Logo className="mb-8 h-12 w-12" />
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Gift className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-black text-foreground">
            {ctx.t("کد دعوت داری؟", "Have a referral code?")}
          </h1>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            {ctx.t(
              "اگر دوستی روتینو رو بهت معرفی کرده، کد شش‌حرفی اون رو وارد کن. بعد از خرید اولین اشتراک، هر دوتون یک هفته هدیه می‌گیرین.",
              "Enter the six-letter code from the friend who invited you. After your first subscription purchase, you both receive a free week.",
            )}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitReferral();
            }}
          >
            <Input
              className="mt-6 text-center font-mono text-lg font-black tracking-[0.3em] uppercase"
              dir="ltr"
              autoComplete="off"
              autoCapitalize="characters"
              aria-label={ctx.t("کد دعوت", "Referral code")}
              placeholder="ABCDEF"
              value={referralCode}
              onChange={(event) => {
                setReferralCode(normalizeReferralCode(event.target.value));
                setReferralError(null);
              }}
            />
            {referralError && (
              <p className="mt-2 text-xs font-medium text-destructive" role="alert">
                {referralError}
              </p>
            )}
            <Button
              type="submit"
              className="mt-4 min-h-11 w-full"
              disabled={referralBusy || referralCode.length !== 6}
            >
              {referralBusy ? ctx.t("در حال ثبت…", "Submitting…") : ctx.t("ثبت کد", "Submit code")}
            </Button>
          </form>
          <button
            type="button"
            className="mt-3 min-h-11 rounded-xl py-2 text-sm font-bold text-muted-foreground hover:text-foreground"
            onClick={finishReferralPrompt}
          >
            {ctx.t("فعلاً رد می‌کنم", "Skip for now")}
          </button>
        </section>
      ) : (
        <PersonalizationFlow
          initialDraft={draft}
          lang={ctx.lang}
          t={ctx.t}
          onDraftChange={(nextDraft) => {
            setDraft(nextDraft);
            saveOnboardingDraft(nextDraft);
          }}
          onComplete={(completedDraft) => void complete(completedDraft)}
        />
      )}
    </main>
  );
}
