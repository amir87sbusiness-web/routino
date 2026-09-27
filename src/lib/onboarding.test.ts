import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultOnboardingDraft,
  loadOnboardingDraft,
  sameWeekdays,
  saveOnboardingDraft,
} from "./onboarding";

const legacyDraft = {
  version: 3,
  ownerUserId: "user-1",
  goalId: "study",
  focusId: "study_focus",
  barrier: "focus",
  pace: "balanced",
  dayPart: "morning",
  weekdays: [1, 3, 5],
  reminderEnabled: true,
  selectedHabitIds: ["study-focus"],
};

describe("onboarding draft referral prompt", () => {
  beforeEach(() => localStorage.clear());

  it("leaves the referral prompt pending for a newly created draft", () => {
    expect(defaultOnboardingDraft("user-1")).toMatchObject({
      version: 4,
      ownerUserId: "user-1",
      referralPromptCompleted: false,
    });
  });

  it("migrates a valid v3 draft without losing personalization and does not replay the prompt", () => {
    localStorage.setItem("routino:onboarding:v3", JSON.stringify(legacyDraft));

    expect(loadOnboardingDraft("user-1")).toEqual({
      ...legacyDraft,
      version: 4,
      referralPromptCompleted: true,
    });
  });

  it("stores and reloads a v4 draft", () => {
    const draft = {
      ...defaultOnboardingDraft("user-1"),
      referralPromptCompleted: true,
      goalId: "health" as const,
    };

    saveOnboardingDraft(draft);

    expect(loadOnboardingDraft("user-1")).toEqual(draft);
    expect(localStorage.getItem("routino:onboarding:v3")).toBeNull();
  });
});

describe("weekday selection equality", () => {
  it("compares weekdays as a set instead of depending on array order", () => {
    expect(sameWeekdays([6, 0, 1, 2, 3], [0, 1, 2, 3, 6])).toBe(true);
    expect(sameWeekdays([6, 1, 3], [1, 3, 6])).toBe(true);
    expect(sameWeekdays([0, 1, 2], [0, 1, 3])).toBe(false);
  });
});
