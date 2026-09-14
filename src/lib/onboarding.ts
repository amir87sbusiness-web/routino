import type { Lang } from "./dates";
import { DEFAULT_CATEGORIES } from "./presets";
import { uid, type Db, type Habit } from "./store";

export type OnboardingGoalId = "sport" | "study" | "health" | "productive" | "sleep" | "growth";
export type OnboardingFocusId =
  | "sport_strength"
  | "sport_movement"
  | "sport_flexibility"
  | "study_focus"
  | "study_consistency"
  | "study_exam"
  | "health_energy"
  | "health_calm"
  | "health_basics"
  | "productive_focus"
  | "productive_planning"
  | "productive_distraction"
  | "sleep_schedule"
  | "sleep_earlier"
  | "sleep_winddown"
  | "growth_reading"
  | "growth_skill"
  | "growth_mindset";
export type OnboardingDayPart = "morning" | "day" | "evening" | "anytime";
export type OnboardingPace = "gentle" | "balanced" | "ambitious";
export type OnboardingBarrier = "starting" | "remembering" | "focus" | "consistency";

export interface OnboardingDraft {
  version: 3;
  ownerUserId: string;
  goalId: OnboardingGoalId | null;
  focusId: OnboardingFocusId | null;
  barrier: OnboardingBarrier | null;
  pace: OnboardingPace | null;
  dayPart: OnboardingDayPart | null;
  weekdays: number[];
  reminderEnabled: boolean;
  selectedHabitIds: string[];
}

export interface OnboardingSuggestion {
  id: string;
  categoryId: string;
  focusIds: OnboardingFocusId[];
  nameFa: string;
  nameEn: string;
  type: "binary" | "quantity";
  target: number;
  unitFa?: string;
  unitEn?: string;
  unitKind?: "count" | "time";
}

export interface OnboardingGoal {
  id: OnboardingGoalId;
  categoryId: string;
  titleFa: string;
  titleEn: string;
  descriptionFa: string;
  descriptionEn: string;
}

export interface OnboardingFocus {
  id: OnboardingFocusId;
  goalId: OnboardingGoalId;
  titleFa: string;
  titleEn: string;
  descriptionFa: string;
  descriptionEn: string;
}

const STORAGE_KEY = "routino:onboarding:v3";
const GOAL_IDS: OnboardingGoalId[] = ["sport", "study", "health", "productive", "sleep", "growth"];
const BARRIERS: OnboardingBarrier[] = ["starting", "remembering", "focus", "consistency"];
const PACES: OnboardingPace[] = ["gentle", "balanced", "ambitious"];
const DAY_PARTS: OnboardingDayPart[] = ["morning", "day", "evening", "anytime"];

export const ONBOARDING_GOALS: OnboardingGoal[] = [
  {
    id: "sport",
    categoryId: "sport",
    titleFa: "ورزش و تحرک",
    titleEn: "Movement & fitness",
    descriptionFa: "بدن قوی‌تر و تحرک بیشتر",
    descriptionEn: "Build strength and move more",
  },
  {
    id: "study",
    categoryId: "study",
    titleFa: "درس و یادگیری",
    titleEn: "Study & learning",
    descriptionFa: "مطالعه‌ی منظم و تمرکز بهتر",
    descriptionEn: "Study consistently and focus better",
  },
  {
    id: "health",
    categoryId: "health",
    titleFa: "سلامتی",
    titleEn: "Wellbeing",
    descriptionFa: "انرژی بیشتر و حال بهتر",
    descriptionEn: "Feel better and have more energy",
  },
  {
    id: "productive",
    categoryId: "productive",
    titleFa: "تمرکز و کار",
    titleEn: "Focus & work",
    descriptionFa: "کارهای مهم‌تر با حواس‌پرتی کمتر",
    descriptionEn: "Do important work with fewer distractions",
  },
  {
    id: "sleep",
    categoryId: "sleep",
    titleFa: "خواب و انرژی",
    titleEn: "Sleep & energy",
    descriptionFa: "خواب منظم‌تر و صبح بهتر",
    descriptionEn: "Sleep more consistently and wake better",
  },
  {
    id: "growth",
    categoryId: "growth",
    titleFa: "رشد فردی",
    titleEn: "Personal growth",
    descriptionFa: "یادگیری، مطالعه و ذهن آرام‌تر",
    descriptionEn: "Learn, read, and grow with intention",
  },
];

export const ONBOARDING_FOCUSES: OnboardingFocus[] = [
  {
    id: "sport_strength",
    goalId: "sport",
    titleFa: "قدرت و فرم بدنی",
    titleEn: "Strength",
    descriptionFa: "تمرین‌های کوتاه ولی منظم",
    descriptionEn: "Short, consistent workouts",
  },
  {
    id: "sport_movement",
    goalId: "sport",
    titleFa: "تحرک بیشتر",
    titleEn: "Move more",
    descriptionFa: "کمتر نشستن و بیشتر حرکت کردن",
    descriptionEn: "Sit less and move more",
  },
  {
    id: "sport_flexibility",
    goalId: "sport",
    titleFa: "کشش و انعطاف",
    titleEn: "Mobility",
    descriptionFa: "بدن سبک‌تر و منعطف‌تر",
    descriptionEn: "Feel looser and more mobile",
  },
  {
    id: "study_focus",
    goalId: "study",
    titleFa: "تمرکز موقع مطالعه",
    titleEn: "Study focus",
    descriptionFa: "زمان مطالعه‌ی بدون حواس‌پرتی",
    descriptionEn: "Distraction-free study time",
  },
  {
    id: "study_consistency",
    goalId: "study",
    titleFa: "مطالعه‌ی هرروزه",
    titleEn: "Daily consistency",
    descriptionFa: "کم، ولی پیوسته جلو رفتن",
    descriptionEn: "Small progress every day",
  },
  {
    id: "study_exam",
    goalId: "study",
    titleFa: "آزمون و امتحان",
    titleEn: "Exam prep",
    descriptionFa: "مرور، تست و جمع‌بندی",
    descriptionEn: "Review, practice, and prepare",
  },
  {
    id: "health_energy",
    goalId: "health",
    titleFa: "انرژی بیشتر",
    titleEn: "More energy",
    descriptionFa: "آب، حرکت و شروع بهتر روز",
    descriptionEn: "Hydration, movement, and better mornings",
  },
  {
    id: "health_calm",
    goalId: "health",
    titleFa: "آرامش ذهن",
    titleEn: "Calmer mind",
    descriptionFa: "تنفس، مکث و فشار کمتر",
    descriptionEn: "Breathe, pause, and reduce stress",
  },
  {
    id: "health_basics",
    goalId: "health",
    titleFa: "اصول سلامتی",
    titleEn: "Healthy basics",
    descriptionFa: "چند عادت ساده برای بدن",
    descriptionEn: "Simple habits for your body",
  },
  {
    id: "productive_focus",
    goalId: "productive",
    titleFa: "کار عمیق",
    titleEn: "Deep work",
    descriptionFa: "یک کار مهم، بدون قطع شدن",
    descriptionEn: "One important task without interruption",
  },
  {
    id: "productive_planning",
    goalId: "productive",
    titleFa: "برنامه‌ریزی بهتر",
    titleEn: "Better planning",
    descriptionFa: "بدانی امروز دقیقاً چه کار کنی",
    descriptionEn: "Know exactly what matters today",
  },
  {
    id: "productive_distraction",
    goalId: "productive",
    titleFa: "حواس‌پرتی کمتر",
    titleEn: "Fewer distractions",
    descriptionFa: "کنترل موبایل و شبکه‌های اجتماعی",
    descriptionEn: "Control phone and social distractions",
  },
  {
    id: "sleep_schedule",
    goalId: "sleep",
    titleFa: "ساعت خواب ثابت",
    titleEn: "Consistent schedule",
    descriptionFa: "خواب و بیداری در ساعت مشخص",
    descriptionEn: "Sleep and wake at consistent times",
  },
  {
    id: "sleep_earlier",
    goalId: "sleep",
    titleFa: "زودتر خوابیدن",
    titleEn: "Sleep earlier",
    descriptionFa: "شب را زودتر جمع کردن",
    descriptionEn: "End the day a little earlier",
  },
  {
    id: "sleep_winddown",
    goalId: "sleep",
    titleFa: "آرام شدن قبل خواب",
    titleEn: "Wind down",
    descriptionFa: "کم‌کردن محرک‌ها قبل از خواب",
    descriptionEn: "Reduce stimulation before bed",
  },
  {
    id: "growth_reading",
    goalId: "growth",
    titleFa: "مطالعه",
    titleEn: "Reading",
    descriptionFa: "هر روز چند دقیقه کتاب",
    descriptionEn: "Read a little every day",
  },
  {
    id: "growth_skill",
    goalId: "growth",
    titleFa: "یادگیری مهارت",
    titleEn: "Learn a skill",
    descriptionFa: "تمرین مداوم یک مهارت",
    descriptionEn: "Practice one skill consistently",
  },
  {
    id: "growth_mindset",
    goalId: "growth",
    titleFa: "ذهن و خودشناسی",
    titleEn: "Mindset",
    descriptionFa: "ژورنال، شکرگزاری و تأمل",
    descriptionEn: "Reflect, journal, and practice gratitude",
  },
];

const SUGGESTIONS: Record<OnboardingGoalId, OnboardingSuggestion[]> = {
  sport: [
    {
      id: "sport-walk",
      categoryId: "sport",
      focusIds: ["sport_movement"],
      nameFa: "۱۰ دقیقه پیاده‌روی",
      nameEn: "10-minute walk",
      type: "quantity",
      target: 10,
      unitKind: "time",
    },
    {
      id: "sport-pushups",
      categoryId: "sport",
      focusIds: ["sport_strength"],
      nameFa: "۱۰ شنا",
      nameEn: "10 push-ups",
      type: "quantity",
      target: 10,
      unitFa: "عدد",
      unitEn: "reps",
      unitKind: "count",
    },
    {
      id: "sport-squats",
      categoryId: "sport",
      focusIds: ["sport_strength"],
      nameFa: "۱۵ اسکات",
      nameEn: "15 squats",
      type: "quantity",
      target: 15,
      unitFa: "عدد",
      unitEn: "reps",
      unitKind: "count",
    },
    {
      id: "sport-stretch",
      categoryId: "sport",
      focusIds: ["sport_flexibility", "sport_movement"],
      nameFa: "۵ دقیقه کشش",
      nameEn: "5-minute stretch",
      type: "quantity",
      target: 5,
      unitKind: "time",
    },
    {
      id: "sport-plank",
      categoryId: "sport",
      focusIds: ["sport_strength"],
      nameFa: "۱ دقیقه پلانک",
      nameEn: "1-minute plank",
      type: "quantity",
      target: 1,
      unitKind: "time",
    },
    {
      id: "sport-move-break",
      categoryId: "sport",
      focusIds: ["sport_movement", "sport_flexibility"],
      nameFa: "هر روز یک استراحت حرکتی",
      nameEn: "Take one movement break",
      type: "binary",
      target: 1,
    },
  ],
  study: [
    {
      id: "study-focus",
      categoryId: "study",
      focusIds: ["study_focus"],
      nameFa: "۲۵ دقیقه مطالعه بدون موبایل",
      nameEn: "25 minutes of phone-free study",
      type: "quantity",
      target: 25,
      unitKind: "time",
    },
    {
      id: "study-daily",
      categoryId: "study",
      focusIds: ["study_consistency"],
      nameFa: "۲۰ دقیقه مطالعه",
      nameEn: "20-minute study session",
      type: "quantity",
      target: 20,
      unitKind: "time",
    },
    {
      id: "study-review",
      categoryId: "study",
      focusIds: ["study_consistency", "study_exam"],
      nameFa: "۱۰ دقیقه مرور درس‌های امروز",
      nameEn: "10-minute review of today's notes",
      type: "quantity",
      target: 10,
      unitKind: "time",
    },
    {
      id: "study-questions",
      categoryId: "study",
      focusIds: ["study_exam"],
      nameFa: "۱۰ تست یا تمرین",
      nameEn: "10 practice questions",
      type: "quantity",
      target: 10,
      unitFa: "تست",
      unitEn: "questions",
      unitKind: "count",
    },
    {
      id: "study-flashcards",
      categoryId: "study",
      focusIds: ["study_exam", "study_consistency"],
      nameFa: "مرور فلش‌کارت‌ها",
      nameEn: "Review flashcards",
      type: "binary",
      target: 1,
    },
    {
      id: "study-plan",
      categoryId: "study",
      focusIds: ["study_focus", "study_consistency"],
      nameFa: "مشخص کردن کار اصلی مطالعه",
      nameEn: "Pick the main study task",
      type: "binary",
      target: 1,
    },
  ],
  health: [
    {
      id: "health-water",
      categoryId: "health",
      focusIds: ["health_energy", "health_basics"],
      nameFa: "۶ لیوان آب",
      nameEn: "Drink 6 glasses of water",
      type: "quantity",
      target: 6,
      unitFa: "لیوان",
      unitEn: "glasses",
      unitKind: "count",
    },
    {
      id: "health-walk",
      categoryId: "health",
      focusIds: ["health_energy", "health_basics"],
      nameFa: "۱۰ دقیقه پیاده‌روی",
      nameEn: "10-minute walk",
      type: "quantity",
      target: 10,
      unitKind: "time",
    },
    {
      id: "health-breathe",
      categoryId: "health",
      focusIds: ["health_calm"],
      nameFa: "۵ دقیقه تنفس آرام",
      nameEn: "5 minutes of calm breathing",
      type: "quantity",
      target: 5,
      unitKind: "time",
    },
    {
      id: "health-fruit",
      categoryId: "health",
      focusIds: ["health_basics"],
      nameFa: "یک وعده میوه یا سبزیجات",
      nameEn: "One serving of fruit or vegetables",
      type: "binary",
      target: 1,
    },
    {
      id: "health-sun",
      categoryId: "health",
      focusIds: ["health_energy"],
      nameFa: "۵ دقیقه نور صبح",
      nameEn: "5 minutes of morning light",
      type: "quantity",
      target: 5,
      unitKind: "time",
    },
    {
      id: "health-pause",
      categoryId: "health",
      focusIds: ["health_calm"],
      nameFa: "یک مکث بدون موبایل",
      nameEn: "Take one phone-free pause",
      type: "binary",
      target: 1,
    },
  ],
  productive: [
    {
      id: "productive-deep",
      categoryId: "productive",
      focusIds: ["productive_focus"],
      nameFa: "۲۵ دقیقه کار عمیق",
      nameEn: "25 minutes of deep work",
      type: "quantity",
      target: 25,
      unitKind: "time",
    },
    {
      id: "productive-top3",
      categoryId: "productive",
      focusIds: ["productive_planning"],
      nameFa: "نوشتن ۳ کار مهم روز",
      nameEn: "Write today's top 3 tasks",
      type: "binary",
      target: 1,
    },
    {
      id: "productive-first",
      categoryId: "productive",
      focusIds: ["productive_focus", "productive_planning"],
      nameFa: "انجام مهم‌ترین کار قبل از کارهای ریز",
      nameEn: "Do the most important task first",
      type: "binary",
      target: 1,
    },
    {
      id: "productive-phone",
      categoryId: "productive",
      focusIds: ["productive_distraction"],
      nameFa: "۳۰ دقیقه بدون شبکه اجتماعی",
      nameEn: "30 minutes without social media",
      type: "quantity",
      target: 30,
      unitKind: "time",
    },
    {
      id: "productive-pomodoro",
      categoryId: "productive",
      focusIds: ["productive_focus"],
      nameFa: "یک پومودورو کامل",
      nameEn: "Complete one Pomodoro",
      type: "binary",
      target: 1,
    },
    {
      id: "productive-tomorrow",
      categoryId: "productive",
      focusIds: ["productive_planning"],
      nameFa: "برنامه فردا قبل از پایان روز",
      nameEn: "Plan tomorrow before ending the day",
      type: "binary",
      target: 1,
    },
  ],
  sleep: [
    {
      id: "sleep-fixed",
      categoryId: "sleep",
      focusIds: ["sleep_schedule"],
      nameFa: "خوابیدن در ساعت مشخص",
      nameEn: "Go to bed at a consistent time",
      type: "binary",
      target: 1,
    },
    {
      id: "sleep-wake",
      categoryId: "sleep",
      focusIds: ["sleep_schedule"],
      nameFa: "بیدار شدن در ساعت مشخص",
      nameEn: "Wake up at a consistent time",
      type: "binary",
      target: 1,
    },
    {
      id: "sleep-phone",
      categoryId: "sleep",
      focusIds: ["sleep_earlier", "sleep_winddown"],
      nameFa: "۳۰ دقیقه قبل خواب بدون موبایل",
      nameEn: "No phone 30 minutes before bed",
      type: "binary",
      target: 1,
    },
    {
      id: "sleep-winddown",
      categoryId: "sleep",
      focusIds: ["sleep_winddown"],
      nameFa: "۱۰ دقیقه آماده شدن برای خواب",
      nameEn: "10-minute wind-down routine",
      type: "quantity",
      target: 10,
      unitKind: "time",
    },
    {
      id: "sleep-lights",
      categoryId: "sleep",
      focusIds: ["sleep_earlier", "sleep_winddown"],
      nameFa: "کم کردن نور قبل خواب",
      nameEn: "Dim lights before bed",
      type: "binary",
      target: 1,
    },
    {
      id: "sleep-bed",
      categoryId: "sleep",
      focusIds: ["sleep_earlier"],
      nameFa: "رفتن به تخت کمی زودتر",
      nameEn: "Get into bed a little earlier",
      type: "binary",
      target: 1,
    },
  ],
  growth: [
    {
      id: "growth-read",
      categoryId: "growth",
      focusIds: ["growth_reading"],
      nameFa: "۱۰ دقیقه کتاب خواندن",
      nameEn: "Read for 10 minutes",
      type: "quantity",
      target: 10,
      unitKind: "time",
    },
    {
      id: "growth-skill",
      categoryId: "growth",
      focusIds: ["growth_skill"],
      nameFa: "۱۵ دقیقه تمرین یک مهارت",
      nameEn: "Practice a skill for 15 minutes",
      type: "quantity",
      target: 15,
      unitKind: "time",
    },
    {
      id: "growth-language",
      categoryId: "growth",
      focusIds: ["growth_skill"],
      nameFa: "۱۰ دقیقه تمرین زبان",
      nameEn: "10 minutes of language practice",
      type: "quantity",
      target: 10,
      unitKind: "time",
    },
    {
      id: "growth-gratitude",
      categoryId: "growth",
      focusIds: ["growth_mindset"],
      nameFa: "نوشتن ۳ مورد شکرگزاری",
      nameEn: "Write 3 gratitudes",
      type: "binary",
      target: 1,
    },
    {
      id: "growth-journal",
      categoryId: "growth",
      focusIds: ["growth_mindset"],
      nameFa: "۵ دقیقه نوشتن برای خودم",
      nameEn: "Write for yourself for 5 minutes",
      type: "quantity",
      target: 5,
      unitKind: "time",
    },
    {
      id: "growth-learn",
      categoryId: "growth",
      focusIds: ["growth_reading", "growth_skill"],
      nameFa: "یاد گرفتن یک نکته جدید",
      nameEn: "Learn one new thing",
      type: "binary",
      target: 1,
    },
  ],
};

export function getOnboardingFocuses(goalId: OnboardingGoalId): OnboardingFocus[] {
  return ONBOARDING_FOCUSES.filter((focus) => focus.goalId === goalId);
}

export function defaultOnboardingDraft(ownerUserId: string): OnboardingDraft {
  return {
    version: 3,
    ownerUserId,
    goalId: null,
    focusId: null,
    barrier: null,
    pace: null,
    dayPart: null,
    weekdays: [],
    reminderEnabled: false,
    selectedHabitIds: [],
  };
}

export function getOnboardingSuggestions(
  goalId: OnboardingGoalId,
  focusId: OnboardingFocusId | null = null,
): OnboardingSuggestion[] {
  const suggestions = SUGGESTIONS[goalId];
  if (!focusId) return suggestions;
  return [...suggestions].sort(
    (a, b) => Number(b.focusIds.includes(focusId)) - Number(a.focusIds.includes(focusId)),
  );
}

export function maxStarterHabits(pace: OnboardingPace | null): number {
  if (pace === "gentle") return 2;
  if (pace === "ambitious") return 4;
  return 3;
}

export function applyOnboardingHabits(
  db: Db,
  draft: OnboardingDraft,
  lang: Lang,
  now = Date.now(),
  makeId: () => string = uid,
): Db {
  const suggestions = Object.values(SUGGESTIONS).flat();
  const byId = new Map(suggestions.map((suggestion) => [suggestion.id, suggestion]));
  const activeNames = new Set(
    db.habits
      .filter((habit) => !habit.archived)
      .map((habit) => habit.name.trim().toLocaleLowerCase()),
  );
  const reminderTime = draft.reminderEnabled
    ? { morning: "08:00", day: "14:00", evening: "20:00", anytime: "09:00" }[
        draft.dayPart ?? "anytime"
      ]
    : null;
  const weekdays = [...new Set(draft.weekdays)].sort((a, b) => a - b);
  const created: Habit[] = [];

  for (const id of draft.selectedHabitIds.slice(0, maxStarterHabits(draft.pace))) {
    const suggestion = byId.get(id);
    if (!suggestion || suggestion.categoryId !== draft.goalId) continue;
    const name = lang === "fa" ? suggestion.nameFa : suggestion.nameEn;
    const normalized = name.trim().toLocaleLowerCase();
    if (!name.trim() || activeNames.has(normalized)) continue;
    activeNames.add(normalized);
    const isQuantity = suggestion.type === "quantity";
    const isTime = suggestion.unitKind === "time";
    created.push({
      id: makeId(),
      name,
      categoryId: suggestion.categoryId,
      type: suggestion.type,
      target: suggestion.type === "binary" ? 1 : Math.max(1, suggestion.target),
      unit:
        isQuantity && !isTime ? (lang === "fa" ? suggestion.unitFa : suggestion.unitEn) : undefined,
      unitKind: isQuantity ? (suggestion.unitKind ?? "count") : undefined,
      schedule:
        weekdays.length >= 7
          ? { kind: "daily" }
          : { kind: "weekdays", weekdays: weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6] },
      monthlyGoal: null,
      reminderTime,
      createdAt: now,
    });
  }

  if (!created.length) return db;
  const neededCategories = new Set(created.map((habit) => habit.categoryId));
  const missingCategories = DEFAULT_CATEGORIES.filter(
    (category) =>
      neededCategories.has(category.id) &&
      !db.categories.some((existing) => existing.id === category.id),
  );
  return {
    ...db,
    categories: missingCategories.length ? [...db.categories, ...missingCategories] : db.categories,
    habits: [...db.habits, ...created],
  };
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function loadOnboardingDraft(ownerUserId?: string): OnboardingDraft | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<OnboardingDraft>;
    if (
      parsed.version !== 3 ||
      typeof parsed.ownerUserId !== "string" ||
      !parsed.ownerUserId ||
      (ownerUserId && parsed.ownerUserId !== ownerUserId) ||
      (parsed.goalId !== null && !GOAL_IDS.includes(parsed.goalId as OnboardingGoalId)) ||
      (parsed.focusId !== null &&
        !ONBOARDING_FOCUSES.some((focus) => focus.id === parsed.focusId)) ||
      (parsed.barrier !== null && !BARRIERS.includes(parsed.barrier as OnboardingBarrier)) ||
      (parsed.pace !== null && !PACES.includes(parsed.pace as OnboardingPace)) ||
      (parsed.dayPart !== null && !DAY_PARTS.includes(parsed.dayPart as OnboardingDayPart)) ||
      !Array.isArray(parsed.weekdays) ||
      !parsed.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) ||
      typeof parsed.reminderEnabled !== "boolean" ||
      !Array.isArray(parsed.selectedHabitIds) ||
      !parsed.selectedHabitIds.every((id) => typeof id === "string")
    ) {
      return null;
    }
    if (parsed.focusId && parsed.goalId) {
      const focus = ONBOARDING_FOCUSES.find((item) => item.id === parsed.focusId);
      if (!focus || focus.goalId !== parsed.goalId) return null;
    }
    return parsed as OnboardingDraft;
  } catch {
    return null;
  }
}

export function clearOnboardingDraft(): void {
  localStorage.removeItem(STORAGE_KEY);
}
