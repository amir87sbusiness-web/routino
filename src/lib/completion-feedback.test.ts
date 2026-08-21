import { describe, expect, it } from "vitest";
import { shouldTriggerCompletionFeedback } from "./completion-feedback";

describe("shouldTriggerCompletionFeedback", () => {
  it("allows a direct incomplete to completed transition", () => {
    expect(
      shouldTriggerCompletionFeedback({
        source: "user",
        mutationAccepted: true,
        beforeCompleted: false,
        afterCompleted: true,
      }),
    ).toBe(true);
  });

  it("rejects undo and quantity changes that remain incomplete", () => {
    expect(
      shouldTriggerCompletionFeedback({
        source: "user",
        mutationAccepted: true,
        beforeCompleted: true,
        afterCompleted: false,
      }),
    ).toBe(false);
    expect(
      shouldTriggerCompletionFeedback({
        source: "user",
        mutationAccepted: true,
        beforeCompleted: false,
        afterCompleted: false,
      }),
    ).toBe(false);
  });

  it("allows a quantity interaction that crosses its target", () => {
    expect(
      shouldTriggerCompletionFeedback({
        source: "user",
        mutationAccepted: true,
        beforeCompleted: false,
        afterCompleted: true,
      }),
    ).toBe(true);
  });

  it("rejects remote or hydrated changes and read-only blocked actions", () => {
    expect(
      shouldTriggerCompletionFeedback({
        source: "remote",
        mutationAccepted: true,
        beforeCompleted: false,
        afterCompleted: true,
      }),
    ).toBe(false);
    expect(
      shouldTriggerCompletionFeedback({
        source: "hydration",
        mutationAccepted: true,
        beforeCompleted: false,
        afterCompleted: true,
      }),
    ).toBe(false);
    expect(
      shouldTriggerCompletionFeedback({
        source: "user",
        mutationAccepted: false,
        beforeCompleted: false,
        afterCompleted: true,
      }),
    ).toBe(false);
  });
});
