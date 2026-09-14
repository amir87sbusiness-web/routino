import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PersonalizationFlow } from "@/components/OnboardingFlow";
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

  const ready =
    !!ctx?.db &&
    !!ctx.db.auth &&
    !!userId &&
    subscriptionActive(ctx.db) &&
    !!draft &&
    draft.ownerUserId === userId;

  useEffect(() => {
    if (!ctx?.db || ready) return;
    navigate({ to: "/" });
  }, [ctx?.db, navigate, ready]);

  if (!ctx?.db || !draft || !ready) return null;

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
        onComplete={(completedDraft) => {
          const accepted = ctx.update((current) => {
            const personalized = applyOnboardingHabits(current, completedDraft, ctx.lang);
            return {
              ...personalized,
              settings: { ...personalized.settings, onboarded: true },
            };
          });
          if (!accepted) {
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
        }}
      />
    </main>
  );
}
