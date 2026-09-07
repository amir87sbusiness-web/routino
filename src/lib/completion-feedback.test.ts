import { afterEach, describe, expect, it, vi } from "vitest";
import {
  preloadCompletionCue,
  shouldTriggerCompletionFeedback,
  triggerCompletionFeedback,
} from "./completion-feedback";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("triggerCompletionFeedback", () => {
  it("plays the supplied completion sound from the beginning", () => {
    const instances: Array<{
      src: string;
      currentTime: number;
      preload: string;
      load: ReturnType<typeof vi.fn>;
      play: ReturnType<typeof vi.fn>;
    }> = [];
    class FakeAudio {
      currentTime = 4;
      preload = "none";
      load = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);

      constructor(public readonly src: string) {
        instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    preloadCompletionCue();
    triggerCompletionFeedback({ completionSoundEnabled: true, hapticsEnabled: false });

    expect(instances).toHaveLength(1);
    expect(instances[0]?.src).toBe("/sounds/completion.mp3");
    expect(instances[0]?.preload).toBe("auto");
    expect(instances[0]?.load).toHaveBeenCalledOnce();
    expect(instances[0]?.currentTime).toBe(0);
    expect(instances[0]?.play).toHaveBeenCalledOnce();
  });
});
