import { emptyDraft, type HabitDraft } from "@/components/habits";
import type { Lang } from "./dates";
import { DEFAULT_CATEGORIES, type PresetHabit } from "./presets";
import type { Category, UnitKind } from "./store";

const TIME_UNIT_WORDS = ["دقیقه", "ساعت", "min", "hour", "hours", "hr"];
const HOUR_WORDS = ["ساعت", "hours", "hour"];

function inferUnitKind(unit: string | undefined): UnitKind {
  if (!unit) return "count";
  return TIME_UNIT_WORDS.some((word) => unit.includes(word)) ? "time" : "count";
}

/** Turns an existing catalog entry into the app's single existing habit draft model. */
export function presetToHabitDraft(
  preset: PresetHabit,
  categoryId: string,
  lang: Lang,
): HabitDraft {
  const unit = lang === "fa" ? preset.unitFa : preset.unitEn;
  const unitKind = inferUnitKind(unit);
  return {
    ...emptyDraft(categoryId),
    name: lang === "fa" ? preset.nameFa : preset.nameEn,
    type: preset.type,
    target:
      unitKind === "time" && HOUR_WORDS.includes(unit ?? "") ? preset.target * 60 : preset.target,
    unit: unitKind === "count" ? (unit ?? "") : "",
    unitKind,
  };
}

/** Restores a deleted default category when a selected catalog preset needs it. */
export function ensurePresetCategory(categories: Category[], categoryId: string): Category[] {
  if (categories.some((category) => category.id === categoryId)) return categories;
  const fallback = DEFAULT_CATEGORIES.find((category) => category.id === categoryId);
  return fallback ? [...categories, fallback] : categories;
}
