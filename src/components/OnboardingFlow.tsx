import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  Leaf,
  MoonStar,
  Rocket,
  ShieldCheck,
  Sparkles,
  Sunrise,
  Target,
} from "lucide-react";
import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Button, Logo } from "@/components/ui";
import { faNum, type Lang } from "@/lib/dates";
import {
  getOnboardingFocuses,
  getOnboardingSuggestions,
  maxStarterHabits,
  ONBOARDING_GOALS,
  type OnboardingBarrier,
  type OnboardingDayPart,
  type OnboardingDraft,
  type OnboardingPace,
} from "@/lib/onboarding";

type T = (fa: string, en: string) => string;

const GOAL_ICONS: Record<NonNullable<OnboardingDraft["goalId"]>, ComponentType<{ className?: string }>> = {
  sport: Dumbbell,
  study: BookOpen,
  health: HeartPulse,
  productive: BriefcaseBusiness,
  sleep: MoonStar,
  growth: Leaf,
};

function ProgressHeader({
  step,
  total,
  lang,
  t,
  onBack,
}: {
  step: number;
  total: number;
  lang: Lang;
  t: T;
  onBack?: () => void;
}) {
  const BackIcon = lang === "fa" ? ChevronRight : ChevronLeft;
  return (
    <header className="flex items-center gap-3 py-1">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t("مرحله قبل", "Previous step")}
        >
          <BackIcon className="h-5 w-5" />
        </button>
      ) : (
        <Logo className="h-10 w-10 shrink-0" />
      )}
      <div className="flex-1">
        <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-muted-foreground">
          <span>{t("ساخت روتین تو", "Build your routine")}</span>
          <span>{t(`${faNum(step + 1, lang)} از ${faNum(total, lang)}`, `${step + 1} of ${total}`)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${((step + 1) / total) * 100}%` }}
          />
        </div>
      </div>
    </header>
  );
}

function StepHeading({
  icon: Icon,
  title,
  body,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="mb-6">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary shadow-sm">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="text-balance text-2xl font-black leading-10 text-foreground">{title}</h1>
      <p className="mt-1.5 text-sm leading-7 text-muted-foreground">{body}</p>
    </div>
  );
}

function Choice({
  active,
  title,
  body,
  icon: Icon,
  onClick,
  disabled,
}: {
  active: boolean;
  title: string;
  body?: string;
  icon?: ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`group flex min-h-16 w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-start transition-[border-color,background-color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45 ${
        active
          ? "border-primary bg-primary-soft text-foreground"
          : "border-border bg-card text-foreground hover:-translate-y-0.5 hover:border-primary/45"
      }`}
    >
      {Icon && (
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
            active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black">{title}</span>
        {body && <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{body}</span>}
      </span>
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${
          active ? "border-primary bg-primary text-primary-foreground" : "border-border"
        }`}
      >
        {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      </span>
    </button>
  );
}

function StepFrame({
  children,
  action,
  footer,
}: {
  children: ReactNode;
  action: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="page-stagger flex-1 overflow-y-auto py-6">{children}</div>
      <div className="border-t border-border/70 bg-background/95 pt-4 backdrop-blur-sm">
        {footer}
        {action}
      </div>
    </div>
  );
}

export function PersonalizationFlow({
  initialDraft,
  initialStep = 0,
  lang,
  t,
  onDraftChange,
  onComplete,
}: {
  initialDraft: OnboardingDraft;
  initialStep?: number;
  lang: Lang;
  t: T;
  onDraftChange: (draft: OnboardingDraft) => void;
  onComplete: (draft: OnboardingDraft) => void;
}) {
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), 7));
  const [draft, setDraft] = useState(initialDraft);
  const maxHabits = maxStarterHabits(draft.pace);
  const focuses = useMemo(() => (draft.goalId ? getOnboardingFocuses(draft.goalId) : []), [draft.goalId]);
  const suggestions = useMemo(
    () => (draft.goalId ? getOnboardingSuggestions(draft.goalId, draft.focusId) : []),
    [draft.goalId, draft.focusId],
  );

  const patch = (next: Partial<OnboardingDraft>) => {
    const value = { ...draft, ...next };
    setDraft(value);
    onDraftChange(value);
  };
  const next = () => setStep((value) => Math.min(7, value + 1));
  const canContinue =
    (step === 0 && !!draft.goalId) ||
    (step === 1 && !!draft.focusId) ||
    (step === 2 && !!draft.barrier) ||
    (step === 3 && !!draft.pace) ||
    (step === 4 && !!draft.dayPart) ||
    (step === 5 && draft.weekdays.length > 0);

  const continueButton = (
    <Button className="min-h-13 w-full rounded-2xl font-black" disabled={!canContinue} onClick={next}>
      {t("ادامه", "Continue")}
      {lang === "fa" ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
    </Button>
  );

  return (
    <div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-md flex-col">
      <ProgressHeader
        step={step}
        total={8}
        lang={lang}
        t={t}
        onBack={step ? () => setStep(step - 1) : undefined}
      />

      {step === 0 && (
        <StepFrame action={continueButton}>
          <StepHeading
            icon={Target}
            title={t("الان بیشتر می‌خوای کدوم بخش زندگیت بهتر بشه؟", "What do you want to improve first?")}
            body={t(
              "فقط یک مسیر رو برای شروع انتخاب کن. قرار نیست همه‌چیز رو یک‌جا درست کنیم.",
              "Pick one direction to start. You do not need to fix everything at once.",
            )}
          />
          <div className="grid grid-cols-1 gap-2.5 min-[390px]:grid-cols-2">
            {ONBOARDING_GOALS.map((goal) => (
              <Choice
                key={goal.id}
                active={draft.goalId === goal.id}
                title={lang === "fa" ? goal.titleFa : goal.titleEn}
                body={lang === "fa" ? goal.descriptionFa : goal.descriptionEn}
                icon={GOAL_ICONS[goal.id]}
                onClick={() =>
                  patch({
                    goalId: goal.id,
                    focusId: null,
                    selectedHabitIds: [],
                  })
                }
              />
            ))}
          </div>
        </StepFrame>
      )}

      {step === 1 && draft.goalId && (
        <StepFrame action={continueButton}>
          <StepHeading
            icon={Sparkles}
            title={t("دقیق‌تر، روی چی تمرکز کنیم؟", "What should we focus on specifically?")}
            body={t(
              "این انتخاب فقط پیشنهادهای مرحله بعد رو دقیق‌تر می‌کنه.",
              "This only helps us make the next suggestions more relevant.",
            )}
          />
          <div className="space-y-2.5">
            {focuses.map((focus) => (
              <Choice
                key={focus.id}
                active={draft.focusId === focus.id}
                title={lang === "fa" ? focus.titleFa : focus.titleEn}
                body={lang === "fa" ? focus.descriptionFa : focus.descriptionEn}
                onClick={() => patch({ focusId: focus.id, selectedHabitIds: [] })}
              />
            ))}
          </div>
        </StepFrame>
      )}

      {step === 2 && (
        <StepFrame action={continueButton}>
          <StepHeading
            icon={Brain}
            title={t("معمولاً کجا رهاش می‌کنی؟", "What usually breaks the routine?")}
            body={t(
              "جواب درست و غلطی نداره؛ می‌خوایم شروع رو متناسب با خودت بچینیم.",
              "There is no right answer. We are shaping a start that fits you.",
            )}
          />
          <div className="space-y-2.5">
            {(
              [
                ["starting", Rocket, "شروع کردن", "می‌دونم چی می‌خوام، ولی شروعش می‌مونه", "Getting started", "I know what to do, but starting is hard"],
                ["remembering", Bell, "یادم می‌ره", "وسط روز از ذهنم می‌ره", "Remembering", "It slips my mind during the day"],
                ["focus", Brain, "تمرکز", "زود حواسم پرت می‌شه", "Focus", "I get distracted quickly"],
                ["consistency", Flame, "پیوستگی", "چند روز خوبم و بعد رها می‌کنم", "Consistency", "I do well for a few days, then stop"],
              ] as const
            ).map(([value, Icon, fa, faBody, en, enBody]) => (
              <Choice
                key={value}
                active={draft.barrier === value}
                icon={Icon}
                title={t(fa, en)}
                body={t(faBody, enBody)}
                onClick={() => patch({ barrier: value as OnboardingBarrier })}
              />
            ))}
          </div>
        </StepFrame>
      )}

      {step === 3 && (
        <StepFrame action={continueButton}>
          <StepHeading
            icon={Footprints}
            title={t("شروع رو چقدر سبک نگه داریم؟", "How small should the start be?")}
            body={t(
              "برای هفته اول، کم‌کردن تعداد عادت‌ها معمولاً از زیادکردن انگیزه مؤثرتره.",
              "For the first week, fewer habits usually beat more motivation.",
            )}
          />
          <div className="space-y-2.5">
            {(
              [
                ["gentle", Footprints, "خیلی سبک", "۲ عادت؛ برای شروع بدون فشار", "Very light", "2 habits; low pressure"],
                ["balanced", Target, "متعادل", "۳ عادت؛ پیشنهاد روتینو", "Balanced", "3 habits; recommended"],
                ["ambitious", Flame, "پرانرژی", "تا ۴ عادت؛ اگر از قبل روتین داری", "Ambitious", "Up to 4 habits; if you already have a routine"],
              ] as const
            ).map(([value, Icon, fa, faBody, en, enBody]) => (
              <Choice
                key={value}
                active={draft.pace === value}
                icon={Icon}
                title={t(fa, en)}
                body={t(faBody, enBody)}
                onClick={() => {
                  const pace = value as OnboardingPace;
                  patch({ pace, selectedHabitIds: draft.selectedHabitIds.slice(0, maxStarterHabits(pace)) });
                }}
              />
            ))}
          </div>
        </StepFrame>
      )}

      {step === 4 && (
        <StepFrame action={continueButton}>
          <StepHeading
            icon={Clock3}
            title={t("چه زمانی احتمال انجامش بیشتره؟", "When are you most likely to do it?")}
            body={t(
              "اگر یادآوری رو روشن کنی، همین بازه مبنای ساعت پیشنهادی می‌شه.",
              "If you enable reminders, this becomes the suggested time window.",
            )}
          />
          <div className="grid grid-cols-2 gap-2.5">
            {(
              [
                ["morning", Sunrise, "صبح", "Morning"],
                ["day", Sparkles, "وسط روز", "Midday"],
                ["evening", MoonStar, "عصر و شب", "Evening"],
                ["anytime", Clock3, "فرقی نداره", "Anytime"],
              ] as const
            ).map(([value, Icon, fa, en]) => (
              <Choice
                key={value}
                active={draft.dayPart === value}
                icon={Icon}
                title={t(fa, en)}
                onClick={() => patch({ dayPart: value as OnboardingDayPart })}
              />
            ))}
          </div>
        </StepFrame>
      )}

      {step === 5 && (
        <StepFrame action={continueButton}>
          <StepHeading
            icon={CalendarDays}
            title={t("چند روز در هفته واقع‌بینانه‌ست؟", "How many days are realistic?")}
            body={t(
              "برنامه‌ای رو انتخاب کن که در یک هفته شلوغ هم بشه نگهش داشت.",
              "Choose a schedule you could still keep during a busy week.",
            )}
          />
          <div className="space-y-2.5">
            <Choice
              active={draft.weekdays.length === 7}
              title={t("هر روز", "Every day")}
              body={t("برای عادت‌های خیلی کوچک و ساده", "Best for tiny, simple habits")}
              onClick={() => patch({ weekdays: [0, 1, 2, 3, 4, 5, 6] })}
            />
            <Choice
              active={
                draft.weekdays.join(",") ===
                (lang === "fa" ? "0,1,2,3,6" : "1,2,3,4,5")
              }
              title={t("۵ روز در هفته", "5 days a week")}
              body={t("ریتم منظم با دو روز استراحت", "A steady rhythm with two lighter days")}
              onClick={() =>
                patch({ weekdays: lang === "fa" ? [6, 0, 1, 2, 3] : [1, 2, 3, 4, 5] })
              }
            />
            <Choice
              active={
                draft.weekdays.join(",") === (lang === "fa" ? "1,3,6" : "1,3,5")
              }
              title={t("۳ روز در هفته", "3 days a week")}
              body={t("شروع سبک و قابل‌کنترل", "A light, manageable start")}
              onClick={() => patch({ weekdays: lang === "fa" ? [6, 1, 3] : [1, 3, 5] })}
            />
          </div>
        </StepFrame>
      )}

      {step === 6 && (
        <StepFrame
          action={
            <Button
              className="min-h-13 w-full rounded-2xl font-black"
              disabled={!draft.selectedHabitIds.length}
              onClick={next}
            >
              {t("ادامه", "Continue")}
              {lang === "fa" ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
            </Button>
          }
          footer={
            <p className="mb-2 text-center text-xs font-bold text-muted-foreground">
              {t(
                `${faNum(draft.selectedHabitIds.length, lang)} از ${faNum(maxHabits, lang)} انتخاب شده`,
                `${draft.selectedHabitIds.length} of ${maxHabits} selected`,
              )}
            </p>
          }
        >
          <StepHeading
            icon={Sparkles}
            title={t("برای هفته اول، کدوما رو برداریم؟", "Which habits should you start with?")}
            body={t(
              `حداقل یکی و حداکثر ${faNum(maxHabits, lang)} مورد انتخاب کن. پیشنهادهای مرتبط‌تر اول اومدن.`,
              `Choose at least one and up to ${maxHabits}. The most relevant suggestions are first.`,
            )}
          />
          <div className="space-y-2.5">
            {suggestions.map((suggestion) => {
              const active = draft.selectedHabitIds.includes(suggestion.id);
              return (
                <Choice
                  key={suggestion.id}
                  active={active}
                  disabled={!active && draft.selectedHabitIds.length >= maxHabits}
                  title={lang === "fa" ? suggestion.nameFa : suggestion.nameEn}
                  onClick={() =>
                    patch({
                      selectedHabitIds: active
                        ? draft.selectedHabitIds.filter((id) => id !== suggestion.id)
                        : [...draft.selectedHabitIds, suggestion.id],
                    })
                  }
                />
              );
            })}
          </div>
        </StepFrame>
      )}

      {step === 7 && (
        <StepFrame
          action={
            <Button
              className="min-h-14 w-full rounded-2xl text-[15px] font-black shadow-lg shadow-primary/20"
              disabled={!draft.selectedHabitIds.length}
              onClick={() => onComplete(draft)}
            >
              <Sparkles className="h-4 w-4" />
              {t("ساخت روتین من", "Build my routine")}
            </Button>
          }
        >
          <StepHeading
            icon={Rocket}
            title={t("روتین شروع آماده‌ست", "Your starter routine is ready")}
            body={t(
              "این فقط نقطه شروعه؛ بعداً هر عادت، روزها و ساعتش رو می‌تونی تغییر بدی.",
              "This is only your starting point. You can change every habit and schedule later.",
            )}
          />

          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
            {draft.selectedHabitIds.map((id, index) => {
              const suggestion = suggestions.find((item) => item.id === id);
              if (!suggestion) return null;
              return (
                <div key={id} className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-xs font-black text-primary">
                    {faNum(index + 1, lang)}
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {lang === "fa" ? suggestion.nameFa : suggestion.nameEn}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-bold text-muted-foreground">
              {t("یادآوری برای این عادت‌ها؟", "Reminders for these habits?")}
            </p>
            <div className="space-y-2.5">
              <Choice
                active={draft.reminderEnabled}
                icon={Bell}
                title={t("بله، یادم بنداز", "Yes, remind me")}
                body={t(
                  "فعلاً یک ساعت پیشنهادی بر اساس زمان انتخابی تو می‌ذاریم",
                  "We'll use a suggested time based on the window you chose",
                )}
                onClick={() => patch({ reminderEnabled: true })}
              />
              <Choice
                active={!draft.reminderEnabled}
                icon={ShieldCheck}
                title={t("فعلاً بدون یادآوری", "Not for now")}
                body={t("بعداً برای هر عادت جداگانه فعالش کن", "You can enable it per habit later")}
                onClick={() => patch({ reminderEnabled: false })}
              />
            </div>
          </div>
        </StepFrame>
      )}
    </div>
  );
}
