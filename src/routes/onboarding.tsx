import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarDays, Globe, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  /**
   * Already onboarded? Leave immediately.
   *
   * This is a recovery path, not a redundant guard. `onboarded` is a SYNCED
   * setting, so it lives in IndexedDB — and when IndexedDB is evicted (iOS under
   * storage pressure, a cleared browser store) the app boots with it false and
   * the gate sends the user here. Sync pulls the real account back a moment
   * later, but nothing was moving them off this screen: someone whose data had
   * just been restored sat reading "Welcome to Routino!", which is the exact
   * moment a person concludes they have lost everything.
   */
  const onboarded = ctx?.db?.settings.onboarded ?? false;
  useEffect(() => {
    if (onboarded) navigate({ to: "/" });
  }, [onboarded, navigate]);

  if (!ctx?.db) return null;
  const { db, updatePreferences, t } = ctx;

  const slides = [
    {
      emoji: "🎯",
      titleFa: "به روتینو خوش اومدی!",
      titleEn: "Welcome to Routino!",
      bodyFa: "عادت‌های خوب بساز، کارهات رو مدیریت کن و هر روز پیشرفتت رو ببین.",
      bodyEn: "Build good habits, manage your tasks, and see your progress every day.",
    },
    {
      emoji: "📊",
      titleFa: "آنالیز و دستاورد",
      titleEn: "Analytics & Achievements",
      bodyFa: "نمودار پیشرفت، استریک روزهای متوالی و نشان‌های تشویقی، همه در یک‌جا.",
      bodyEn: "Progress charts, streaks and motivational badges, all in one place.",
    },
    {
      emoji: "✍️",
      titleFa: "ژورنال و تایمر",
      titleEn: "Journal & Timer",
      bodyFa: "روزت رو ثبت کن، به روزت نمره بده و با تایمر پومودورو روی کارهات تمرکز کن!",
      bodyEn: "Write about your day, rate it, and use the Pomodoro timer to focus on your tasks!",
    },
  ];

  const finish = () => {
    updatePreferences({ onboarded: true });
    navigate({ to: "/auth" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background px-6 py-screen-safe">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {step < slides.length ? (
          <>
            <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
              <span className="text-7xl">{slides[step].emoji}</span>
              <h1 className="text-2xl font-black text-foreground">
                {t(slides[step].titleFa, slides[step].titleEn)}
              </h1>
              <p className="text-sm leading-7 text-muted-foreground">
                {t(slides[step].bodyFa, slides[step].bodyEn)}
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex justify-center gap-1.5">
                {slides.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : "w-1.5 bg-border"}`}
                  />
                ))}
              </div>
              <Button onClick={() => setStep(step + 1)}>{t("ادامه", "Next")}</Button>
              <Button variant="ghost" onClick={() => setStep(slides.length)}>
                {t("رد شدن", "Skip")}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-6">
            <h1 className="text-center text-xl font-black text-foreground">
              {t("تنظیمات اولیه", "Initial setup")}
            </h1>

            <div className="card-surface flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Globe className="h-4 w-4 text-primary" /> {t("زبان", "Language")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["fa", "en"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => updatePreferences({ lang: l })}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                      db.settings.lang === l
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {l === "fa" ? "فارسی" : "English"}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-surface flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <CalendarDays className="h-4 w-4 text-primary" /> {t("تقویم", "Calendar")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["jalali", "gregorian"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => updatePreferences({ calendar: c })}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                      db.settings.calendar === c
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {c === "jalali" ? t("شمسی", "Jalali") : t("میلادی", "Gregorian")}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-surface flex flex-col gap-3 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Sun className="h-4 w-4 text-primary" /> {t("تم", "Theme")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["light", "dark"] as const).map((th) => (
                  <button
                    key={th}
                    onClick={() => updatePreferences({ theme: th })}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                      db.settings.theme === th
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {th === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    {th === "light" ? t("روشن", "Light") : t("تاریک", "Dark")}
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={finish}>{t("شروع کن!", "Let's go!")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
