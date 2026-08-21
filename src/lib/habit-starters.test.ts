import { describe, expect, it } from "vitest";
import { PRESET_HABITS } from "./presets";
import { ensurePresetCategory, presetToHabitDraft } from "./habit-starters";

describe("starter-habit helpers", () => {
  it("converts the real study preset into the existing time-based habit draft", () => {
    const draft = presetToHabitDraft(PRESET_HABITS.study[0]!, "study", "en");

    expect(draft).toMatchObject({
      name: "Study session",
      categoryId: "study",
      type: "quantity",
      target: 60,
      unitKind: "time",
    });
  });

  it("restores a missing default category before saving its preset", () => {
    const categories = ensurePresetCategory([], "study");

    expect(categories).toEqual([
      expect.objectContaining({ id: "study", nameEn: "Study", isDefault: true }),
    ]);
  });
});
