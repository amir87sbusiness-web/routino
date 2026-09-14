import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PersonalizationFlow } from "@/components/OnboardingFlow";
import { entitlementToSubscription, startTrial } from "@/lib/api/auth";
import {
  applyOnboardingHabits,
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
  type OnboardingDraft,
} from "@/lib/onboarding";
import { subscriptionActive } from "@/lib/logic";
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
    navigate({ to: "/" });
  }, [ctx, navigate, pendingCompletion]);

  if (!ctx?.db || !draft || !ready) return null;

  const complete = async (completedDraft: OnboardingDraft) => {
    if (completingRef.current) return;
    completingRef.current = true;
    saveOnboardingDraft(completedDraft);

    if (subscriptionActive(ctx.db)) {
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
    </main>
  );
}
