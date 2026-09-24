import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CATEGORIES } from "@/lib/presets";
import { defaultDb, type Task } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const app = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/habits", () => ({
  MonthCalendarGrid: () => <div data-testid="habit-calendar" />,
}));
vi.mock("@/components/ui", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CatIcon: () => <span />,
  Chip: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  MiniBars: ({ data }: { data: (number | null)[] }) => (
    <div data-testid="bars" data-values={JSON.stringify(data)} />
  ),
  SectionTitle: ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
    <header>
      {children}
      {action}
    </header>
  ),
}));
vi.mock("@/state/app", () => ({ useAppMaybe: () => app.ctx }));

import { Route } from "./analytics";

const AnalyticsRoute = (Route as unknown as { component: () => React.ReactNode }).component;

describe("Analytics tabs", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00"));
    const db = defaultDb(DEFAULT_CATEGORIES);
    db.tasks = [
      {
        id: "done",
        dateKey: "2026-07-05",
        title: "کار انجام‌شده",
        type: "binary",
        target: 1,
        value: 1,
        done: true,
      },
      {
        id: "late",
        dateKey: "2026-07-06",
        title: "کار عقب‌افتاده",
        type: "binary",
        target: 1,
        value: 0,
        done: false,
        deadlineAt: "2026-07-09T18:00",
      } as Task,
    ];
    app.ctx = {
      db,
      t: (fa: string) => fa,
      lang: "fa",
      cal: "gregorian",
    };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<AnalyticsRoute />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("opens on habit analytics without the old mixed task-status section", () => {
    expect(host.textContent).toContain("مرور هفتگی");
    expect(host.textContent).toContain("عملکرد هر عادت");
    expect(host.textContent).not.toContain("وضعیت کارها");
  });

  it("shows range controls for the task chart while monthly task statuses stay independent", async () => {
    const taskTab = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "کارها",
    )!;
    await act(async () => taskTab.click());

    expect(host.textContent).toContain("عملکرد کلی کارها");
    expect(host.textContent).toContain("کار انجام‌شده");
    expect(host.textContent).toContain("کار عقب‌افتاده");
    expect(host.textContent).toContain("به‌تعویق‌افتاده");
    expect(host.textContent).toContain("هفته");
    expect(host.textContent).toContain("ماه");
    expect(host.textContent).toContain("سه‌ماهه");
    expect(host.textContent).toContain("سال");
    expect(host.querySelector('[aria-label="prev-task-month"]')).not.toBeNull();
    expect(host.textContent).not.toContain("مرور هفتگی");
    expect(host.querySelectorAll('[data-testid="bars"]')).toHaveLength(1);

    const quarter = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "سه‌ماهه",
    )!;
    await act(async () => quarter.click());
    expect(host.textContent).toContain("وضعیت کارهای این ماه");
    expect(host.textContent).toContain("کار انجام‌شده");
  });
});
