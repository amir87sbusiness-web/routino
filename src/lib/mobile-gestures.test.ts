import { describe, expect, it } from "vitest";
import {
  dragDirectionForWeekShift,
  resolveWeekSwipe,
  weekPanelShifts,
} from "./mobile-gestures";

describe("resolveWeekSwipe", () => {
  it("maps physical drags to the reversed Persian calendar direction", () => {
    expect(resolveWeekSwipe({ dx: 90, velocityX: 0.2, width: 320, lang: "fa" })).toBe(1);
    expect(resolveWeekSwipe({ dx: -90, velocityX: -0.2, width: 320, lang: "fa" })).toBe(-1);
  });

  it("keeps the conventional English calendar direction", () => {
    expect(resolveWeekSwipe({ dx: 90, velocityX: 0.2, width: 320, lang: "en" })).toBe(-1);
    expect(resolveWeekSwipe({ dx: -90, velocityX: -0.2, width: 320, lang: "en" })).toBe(1);
  });

  it("returns to the current week for a short slow drag", () => {
    expect(resolveWeekSwipe({ dx: 12, velocityX: 0.1, width: 320, lang: "fa" })).toBe(0);
  });

  it("accepts a short deliberate flick", () => {
    expect(resolveWeekSwipe({ dx: 24, velocityX: 0.75, width: 320, lang: "fa" })).toBe(1);
  });
});

describe("weekPanelShifts", () => {
  it("places the next Persian week on the physical left", () => {
    expect(weekPanelShifts("fa")).toEqual([1, 0, -1]);
  });

  it("places the next English week on the physical right", () => {
    expect(weekPanelShifts("en")).toEqual([-1, 0, 1]);
  });
});

describe("dragDirectionForWeekShift", () => {
  it("settles next-week buttons toward the physical left in Persian", () => {
    expect(dragDirectionForWeekShift(1, "fa")).toBe(1);
    expect(dragDirectionForWeekShift(-1, "fa")).toBe(-1);
  });

  it("settles next-week buttons toward the physical right in English", () => {
    expect(dragDirectionForWeekShift(1, "en")).toBe(-1);
    expect(dragDirectionForWeekShift(-1, "en")).toBe(1);
  });
});
