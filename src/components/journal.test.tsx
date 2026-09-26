import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDb, type Db } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MockJournalContext {
  db: Db;
  cal: "gregorian";
  lang: "fa" | "en";
  t: (fa: string, en: string) => string;
  update: (fn: (value: Db) => Db) => boolean;
}

const app = vi.hoisted(() => ({ ctx: null as MockJournalContext | null }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/WeekStrip", () => ({
  WeekStrip: () => null,
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <section className={className}>{children}</section>
  ),
  SectionTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@/state/app", () => ({ useAppMaybe: () => app.ctx }));

import { Route } from "../routes/journal";

const JournalRoute = (Route as unknown as { component: () => React.ReactNode }).component;

describe("Journal choice grids", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    let db = defaultDb([]);
    app.ctx = {
      db,
      cal: "gregorian",
      lang: "fa",
      t: (fa) => fa,
      update: (fn) => {
        db = fn(db);
        app.ctx!.db = db;
        return true;
      },
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<JournalRoute />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  function choiceGrid(label: string) {
    const heading = [...host.querySelectorAll("p")].find(
      (element) => element.textContent === label,
    );
    return heading!.nextElementSibling as HTMLDivElement;
  }

  it("keeps every mood and score choice on one ten-column row and selectable", async () => {
    const moodGrid = choiceGrid("حال و احساس امروز");
    const scoreGrid = choiceGrid("به امروزت چه نمره‌ای می‌دی؟");

    expect(moodGrid.className).toContain("grid-cols-10");
    expect(moodGrid.className).not.toContain("flex-wrap");
    expect(moodGrid.className).toContain("gap-px");
    expect(scoreGrid.className).toContain("grid-cols-10");
    expect(scoreGrid.className).not.toContain("flex-wrap");
    expect(scoreGrid.className).toContain("gap-px");

    for (const grid of [moodGrid, scoreGrid]) {
      expect(grid.parentElement?.className).toContain("p-2");
      expect(grid.parentElement?.className).toContain("sm:p-4");
    }
    const mobileCardContentWidth = 288 - 2 * 8;
    const mobileGridGap = 1;
    expect((mobileCardContentWidth - mobileGridGap * 9) / 10).toBeGreaterThanOrEqual(24);

    const moodButtons = [...moodGrid.querySelectorAll<HTMLButtonElement>("button")];
    const scoreButtons = [...scoreGrid.querySelectorAll<HTMLButtonElement>("button")];
    expect(moodButtons).toHaveLength(10);
    expect(scoreButtons).toHaveLength(10);

    const moodLabels = moodButtons.map((button) => button.getAttribute("aria-label"));
    for (const button of moodButtons) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.getAttribute("aria-label")).toContain("حال و احساس امروز");
    }
    expect(new Set(moodLabels).size).toBe(10);
    expect(moodButtons[0]?.getAttribute("aria-label")).toContain("خیلی شاد");
    expect(moodButtons[5]?.getAttribute("aria-label")).toContain("عصبانی");
    for (const button of scoreButtons) expect(button.getAttribute("aria-pressed")).toBe("false");

    for (const button of moodButtons) {
      await act(async () => button.click());
      expect(button.className).toContain("bg-primary-soft");
      expect(button.getAttribute("aria-pressed")).toBe("true");
    }

    for (const button of scoreButtons) {
      await act(async () => button.click());
      expect(button.className).toContain("border-transparent");
      expect(button.getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("gives mood choices meaningful English accessible names", async () => {
    app.ctx = {
      ...app.ctx!,
      lang: "en",
      t: (_fa, en) => en,
    };
    await act(async () => root.render(<JournalRoute />));

    const moodButtons = [
      ...choiceGrid("Today's mood").querySelectorAll<HTMLButtonElement>("button"),
    ];
    expect(moodButtons[0]?.getAttribute("aria-label")).toContain("Very happy");
    expect(moodButtons[5]?.getAttribute("aria-label")).toContain("Angry");
  });
});
