import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultOnboardingDraft, type OnboardingDraft } from "@/lib/onboarding";
import { PersonalizationFlow } from "./OnboardingFlow";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function readyDraft(weekdays: number[]): OnboardingDraft {
  return {
    ...defaultOnboardingDraft("user-1"),
    goalId: "health",
    focusId: "health_energy",
    barrier: "starting",
    pace: "balanced",
    dayPart: "morning",
    weekdays,
  };
}

describe("PersonalizationFlow weekday choices", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render(lang: "fa" | "en", weekdays: number[]) {
    await act(async () => {
      root.render(
        <PersonalizationFlow
          initialDraft={readyDraft(weekdays)}
          initialStep={5}
          lang={lang}
          t={(fa, en) => (lang === "fa" ? fa : en)}
          onDraftChange={vi.fn()}
          onComplete={vi.fn()}
        />,
      );
    });
  }

  function pressed(label: string): boolean {
    return (
      host
        .querySelector<HTMLButtonElement>(`button[aria-pressed="true"]`)
        ?.textContent?.includes(label) ?? false
    );
  }

  it.each([
    ["fa", [6, 0, 1, 2, 3], "۵ روز در هفته"],
    ["fa", [6, 1, 3], "۳ روز در هفته"],
    ["en", [5, 1, 4, 2, 3], "5 days a week"],
    ["en", [5, 3, 1], "3 days a week"],
    ["fa", [6, 4, 2, 0, 5, 3, 1], "هر روز"],
  ] as const)(
    "marks the %s preset active regardless of stored order",
    async (lang, days, label) => {
      await render(lang, [...days]);
      expect(pressed(label)).toBe(true);
    },
  );

  it("preserves the chosen weekdays after navigating back and forward", async () => {
    await render("fa", []);
    const fiveDays = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("۵ روز در هفته"),
    )!;
    await act(async () => fiveDays.click());
    expect(fiveDays.getAttribute("aria-pressed")).toBe("true");

    const back = host.querySelector<HTMLButtonElement>('button[aria-label="مرحله قبل"]')!;
    await act(async () => back.click());
    const forward = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("ادامه"),
    )!;
    await act(async () => forward.click());

    expect(pressed("۵ روز در هفته")).toBe(true);
  });
});
