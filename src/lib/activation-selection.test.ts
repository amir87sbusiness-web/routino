import { beforeEach, describe, expect, it } from "vitest";
import {
  clearActivationSelection,
  loadActivationSelection,
  saveActivationSelection,
  type ActivationSelection,
} from "./activation-selection";

describe("activation selection persistence", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a prepared starter draft after a retryable activation failure", () => {
    const selection: ActivationSelection = {
      kind: "draft",
      draft: {
        name: "Read 20 minutes",
        categoryId: "growth",
        type: "quantity",
        target: 20,
        unit: "",
        unitKind: "time",
        scheduleKind: "weekdays",
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        monthlyGoal: "30",
        reminderTime: "20:00",
      },
    };

    saveActivationSelection(selection);
    expect(loadActivationSelection()).toEqual(selection);

    clearActivationSelection();
    expect(loadActivationSelection()).toBeNull();
  });
});
