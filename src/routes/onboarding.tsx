import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarDays, Globe, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { useAppMaybe } from "@/state/app";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  if (!ctx?.db) return null;
  const { db, update, t } = ctx;

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
    update((d) => ({ ...d, settings: { ...d.settings, onboarded: true } }));
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
                    onClick={() => update((d) => ({ ...d, settings: { ...d.settings, lang: l } }))}
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
                    onClick={() => update((d) => ({ ...d, settings: { ...d.settings, calendar: c } }))}
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
                    onClick={() => update((d) => ({ ...d, settings: { ...d.settings, theme: th } }))}
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
