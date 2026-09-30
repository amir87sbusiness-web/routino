import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDb, logKey, type Db, type Goal } from "@/lib/store";
import { createGoalItem, goalProgress } from "@/lib/goals";
import { todayKey } from "@/lib/dates";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: React.ComponentProps<"a"> & { to: string; params?: { goalId?: string } }) => (
    <a href={params?.goalId ? to.replace("$goalId", params.goalId) : to} {...props}>
      {children}
    </a>
  ),
}));

import { GoalDetailView, GoalsListView } from "./goals";

const t = (fa: string) => fa;

function activeDb(): Db {
  const db = defaultDb([
    {
      id: "cat",
      nameFa: "سلامتی",
      nameEn: "Health",
      color: "#f97316",
      icon: "heart",
      isDefault: true,
    },
  ]);
  db.settings.lang = "fa";
  db.settings.calendar = "jalali";
  return db;
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    title: "تناسب اندام",
    priority: "normal",
    status: "active",
    items: [],
    createdAt: 1,
    ...overrides,
  };
}

describe("Goals UI", () => {
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

  it("shows active goals before completed goals and creates a minimal goal", async () => {
    let db = activeDb();
    db.goals = [
      goal({ id: "done", title: "تمام‌شده", status: "completed", completedAt: 3 }),
      goal({ id: "active", title: "فعال" }),
    ];
    const update = vi.fn((fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    });

    await act(async () =>
      root.render(<GoalsListView db={db} update={update} t={t} lang="fa" cal="jalali" />),
    );
    expect(host.textContent?.indexOf("فعال")).toBeLessThan(host.textContent!.indexOf("تمام‌شده"));

    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("هدف جدید"))!
        .click(),
    );
    const input = document.body.querySelector(
      'input[placeholder="مثلاً: آمادگی برای ماراتن"]',
    ) as HTMLInputElement;
    await act(async () => {
      input.value = "یادگیری زبان";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("ساخت هدف"))!
        .click(),
    );

    expect(update).toHaveBeenCalled();
    expect(db.goals.some((item) => item.title === "یادگیری زبان")).toBe(true);
  });

  it("adds a custom count item and updates it only inside the goal", async () => {
    let db = activeDb();
    db.goals = [goal()];
    const update = vi.fn((fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    });

    await act(async () =>
      root.render(
        <GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("افزودن به هدف"))!
        .click(),
    );
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("آیتم مستقل"))!
        .click(),
    );

    const title = document.body.querySelector(
      'input[placeholder="مثلاً: ثبت‌نام باشگاه"]',
    ) as HTMLInputElement;
    await act(async () => {
      title.value = "وعده سالم";
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("تعدادی"))!
        .click(),
    );
    const target = document.body.querySelector('input[aria-label="مقدار هدف"]') as HTMLInputElement;
    await act(async () => {
      target.value = "5";
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("افزودن آیتم"))!
        .click(),
    );

    expect(db.goals[0].items).toEqual([
      expect.objectContaining({
        kind: "custom",
        title: "وعده سالم",
        measure: "count",
        target: 5,
        value: 0,
      }),
    ]);
  });

  it("connects an already completed habit and reflects undo and redo in goal progress", async () => {
    let db = activeDb();
    db.goals = [goal()];
    db.habits = [
      {
        id: "habit-1",
        name: "دویدن",
        categoryId: "cat",
        type: "binary",
        target: 1,
        schedule: { kind: "daily" },
        monthlyGoal: null,
        reminderTime: null,
        createdAt: 1,
      },
    ];
    db.logs[logKey("habit-1", todayKey())] = {
      habitId: "habit-1", dateKey: todayKey(), value: 1, done: true,
    };
    const update = vi.fn((fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    });

    await act(async () =>
      root.render(
        <GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("افزودن به هدف"))!
        .click(),
    );
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("اتصال عادت"))!
        .click(),
    );
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("دویدن"))!
        .click(),
    );
    const target = document.body.querySelector(
      'input[aria-label="هدف این آیتم"]',
    ) as HTMLInputElement;
    await act(async () => {
      target.value = "10";
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("اتصال به هدف"))!
        .click(),
    );

    expect(db.goals[0].items).toEqual([
      expect.objectContaining({
        kind: "source",
        sourceType: "habit",
        sourceId: "habit-1",
        target: 10,
      }),
    ]);
    const renderUpdated = async () => {
      await act(async () => root.render(
        <GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />,
      ));
    };
    await renderUpdated();
    const row = () => host.querySelector('[data-goal-item="habit-1"]') as HTMLElement;
    expect(row().textContent).toContain("هدف: ۱ / ۱۰");
    await act(async () => row().querySelector("button")!.click());
    await renderUpdated();
    expect(row().textContent).toContain("هدف: ۰ / ۱۰");
    await act(async () => row().querySelector("button")!.click());
    await renderUpdated();
    expect(row().textContent).toContain("هدف: ۱ / ۱۰");
  });

  it("edits goal metadata without changing its items", async () => {
    let db = activeDb();
    db.goals = [
      goal({
        items: [{ id: "step", kind: "custom", title: "قدم", measure: "binary", value: false }],
      }),
    ];
    const update = vi.fn((fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    });

    await act(async () =>
      root.render(
        <GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.getAttribute("aria-label") === "ویرایش هدف")!
        .click(),
    );
    const title = document.body.querySelector('input[aria-label="عنوان هدف"]') as HTMLInputElement;
    await act(async () => {
      title.value = "هدف ویرایش‌شده";
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("ذخیره تغییرات"))!
        .click(),
    );

    expect(db.goals[0].title).toBe("هدف ویرایش‌شده");
    expect(db.goals[0].items).toHaveLength(1);
  });

  it("lets an empty goal complete directly with completion confirmation kept for the action menu", async () => {
    let db = activeDb();
    db.goals = [goal()];
    const update = vi.fn((fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    });
    await act(async () =>
      root.render(
        <GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />,
      ),
    );
    await act(async () =>
      (host.querySelector('button[aria-label="انجام هدف"]') as HTMLButtonElement).click(),
    );
    expect(db.goals[0].status).toBe("completed");
  });

  it("edits a standalone item target after it was added", async () => {
    let db = activeDb();
    db.goals = [
      goal({
        items: [
          {
            id: "step",
            kind: "custom",
            title: "مطالعه",
            measure: "count",
            value: 2,
            target: 5,
            unit: "صفحه",
          },
        ],
      }),
    ];
    const update = vi.fn((fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    });
    await act(async () =>
      root.render(
        <GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />,
      ),
    );
    await act(async () =>
      (host.querySelector('button[aria-label="گزینه‌های آیتم"]') as HTMLButtonElement).click(),
    );
    await act(async () =>
      (document.body.querySelector('button[aria-label="ویرایش آیتم"]') as HTMLButtonElement).click(),
    );
    const target = document.body.querySelector('input[aria-label="مقدار هدف"]') as HTMLInputElement;
    await act(async () => {
      target.value = "12";
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("ذخیره تغییرات"))!
        .click(),
    );
    expect(db.goals[0].items[0]).toMatchObject({ target: 12, value: 2 });
  });

  it("requires confirmation before removing an item", async () => {
    let db = activeDb();
    db.goals = [
      goal({
        items: [{ id: "step", kind: "custom", title: "قدم", measure: "binary", value: false }],
      }),
    ];
    const update = vi.fn((fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () =>
      root.render(
        <GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />,
      ),
    );
    await act(async () =>
      (host.querySelector('button[aria-label="گزینه‌های آیتم"]') as HTMLButtonElement).click(),
    );
    await act(async () =>
      (document.body.querySelector('button[aria-label="حذف از هدف"]') as HTMLButtonElement).click(),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("مطمئنی می‌خواهی این آیتم را از هدف حذف کنی؟");
    expect(db.goals[0].items).toHaveLength(1);
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "انصراف")!
        .click(),
    );
    expect(db.goals[0].items).toHaveLength(1);
    confirm.mockRestore();
  });

  it("uses the habit amount controls without creating habits or logs for standalone items", async () => {
    let db = activeDb();
    db.goals = [
      goal({
        items: [
          {
            id: "step",
            kind: "custom",
            title: "مطالعه",
            measure: "time",
            valueMinutes: 2,
            targetMinutes: 60,
            note: "یادداشت",
          },
        ],
      }),
    ];
    const habits = db.habits;
    const logs = db.logs;
    const update = (fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    };
    const render = () =>
      root.render(
        <GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />,
      );
    await act(async () => render());
    await act(async () =>
      (host.querySelector('button[aria-label="افزایش مقدار"]') as HTMLButtonElement).click(),
    );
    expect(db.goals[0].items[0]).toMatchObject({ valueMinutes: 3, note: "یادداشت" });
    expect(db.habits).toBe(habits);
    expect(db.logs).toBe(logs);
    await act(async () => render());
    await act(async () =>
      (host.querySelector('button[aria-label="کاهش مقدار"]') as HTMLButtonElement).click(),
    );
    expect(db.goals[0].items[0]).toMatchObject({ valueMinutes: 2 });
  });

  it("returns to the goals list only after accepting deletion and an accepted write", async () => {
    let db = activeDb();
    db.goals = [goal()];
    const onDeleted = vi.fn();
    const update = (fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    };
    await act(async () =>
      root.render(
        <GoalDetailView
          db={db}
          goalId="goal-1"
          update={update}
          onDeleted={onDeleted}
          t={t}
          lang="fa"
          cal="jalali"
        />,
      ),
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "حذف هدف")!
        .click(),
    );
    expect(db.goals).toHaveLength(1);
    expect(onDeleted).not.toHaveBeenCalled();
    await act(async () =>
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent === "تأیید")!
        .click(),
    );
    expect(db.goals).toHaveLength(0);
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it("writes a linked habit's amount to its source without changing the goal", async () => {
    let db = activeDb();
    db.habits = [
      {
        id: "h",
        name: "دویدن",
        categoryId: "cat",
        type: "quantity",
        target: 10,
        unitKind: "count",
        schedule: { kind: "daily" },
        monthlyGoal: null,
        reminderTime: null,
        createdAt: 1,
      },
    ];
    db.goals = [goal({ items: [createGoalItem(db, "habit", "h", 100)] })];
    const goals = db.goals;
    const update = (fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    };
    await act(async () =>
      root.render(
        <GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />,
      ),
    );
    await act(async () =>
      (host.querySelector('button[aria-label="افزایش مقدار"]') as HTMLButtonElement).click(),
    );
    expect(db.logs["h|" + todayKey()].value).toBe(1);
    expect(db.goals).toBe(goals);
  });

  it("keeps binary task rows free of progress bars and exposes item actions inside the row", async () => {
    let db = activeDb();
    db.tasks = [
      { id: "task", dateKey: todayKey(), title: "خرید کفش", type: "binary", target: 1, value: 0, done: false },
    ];
    db.goals = [goal({ items: [createGoalItem(db, "task", "task", 1)] })];
    const update = (fn: (value: Db) => Db) => {
      db = fn(db);
      return true;
    };

    await act(async () =>
      root.render(<GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />),
    );

    const row = host.querySelector('[data-goal-item="task"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.querySelector('[role="progressbar"]')).toBeNull();
    expect(row.querySelector('button[aria-label="گزینه‌های آیتم"]')).toBeTruthy();
    expect(row.parentElement?.querySelector(':scope > [data-goal-item-footer]')).toBeNull();
  });

  it("shows one goal progress bar inside quantity rows and a today summary", async () => {
    let db = activeDb();
    db.habits = [
      { id: "habit", name: "دویدن", categoryId: "cat", type: "quantity", target: 5, unitKind: "count", schedule: { kind: "daily" }, monthlyGoal: null, reminderTime: null, createdAt: 1 },
    ];
    db.goals = [goal({ items: [createGoalItem(db, "habit", "habit", 10)] })];
    const update = (fn: (value: Db) => Db) => { db = fn(db); return true; };

    await act(async () =>
      root.render(<GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />),
    );

    const row = host.querySelector('[data-goal-item="habit"]') as HTMLElement;
    expect(row.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
    expect(row.textContent).toContain("امروز ۰ انجام دادی");
    expect(row.textContent).toContain("هدف: ۰ / ۱۰");
  });

  it("keeps status filters and orders active goals by priority without priority filters", async () => {
    const db = activeDb();
    db.goals = [
      goal({ id: "low", title: "کم‌اولویت", priority: "low" }),
      goal({ id: "medium", title: "متوسط‌اولویت", priority: "normal" }),
      goal({ id: "critical", title: "فوری", priority: "critical" }),
      goal({ id: "high", title: "مهم", priority: "high" }),
    ];
    await act(async () =>
      root.render(<GoalsListView db={db} update={() => true} t={t} lang="fa" cal="jalali" />),
    );
    expect(host.textContent).toContain("خلاصه هدف‌ها");
    expect([...host.querySelectorAll("a h3")].map((title) => title.textContent)).toEqual([
      "فوری", "مهم", "متوسط‌اولویت", "کم‌اولویت",
    ]);
    expect([...host.querySelectorAll("button")].filter((button) =>
      ["کم", "متوسط", "زیاد", "خیلی مهم"].includes(button.textContent ?? ""),
    )).toHaveLength(0);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "فعال")).toBe(true);
    const cards = [...host.querySelectorAll("a:has(h3)")] as HTMLElement[];
    expect(new Set(cards.map((card) => card.style.getPropertyValue("--goal-priority-color"))).size).toBe(4);
  });

  it("reopens a fully completed goal when a standalone item is undone", async () => {
    let db = activeDb();
    db.goals = [goal({ status: "completed", completedAt: 1, items: [
      { id: "step", kind: "custom", title: "قدم", measure: "binary", value: true },
    ] })];
    const update = (fn: (value: Db) => Db) => { db = fn(db); return true; };
    await act(async () => root.render(<GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />));
    const row = host.querySelector('[data-goal-item="step"]')!;
    await act(async () => (row.querySelector("button") as HTMLButtonElement).click());
    expect(db.goals[0]).toMatchObject({ status: "active", completedAt: null });
  });

  it("persists an emoji mood selected for a standalone goal item", async () => {
    let db = activeDb();
    db.goals = [goal({ items: [{ id: "mood", kind: "custom", title: "مطالعه", measure: "binary", value: false }] })];
    const update = (fn: (value: Db) => Db) => { db = fn(db); return true; };
    const render = () => root.render(<GoalDetailView db={db} goalId="goal-1" update={update} t={t} lang="fa" cal="jalali" />);

    await act(async () => render());
    await act(async () =>
      [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("مطالعه"))!.click(),
    );
    await act(async () =>
      [...document.body.querySelectorAll("button")].find((button) => button.textContent === "😄")!.click(),
    );

    expect(db.goals[0].items[0]).toMatchObject({ mood: "😄" });
  });

  it("finishes a fully progressed goal and leaves its detail page", async () => {
    let db = activeDb();
    db.goals = [goal({ items: [{ id: "done", kind: "custom", title: "تمام", measure: "binary", value: true }] })];
    const onCompleted = vi.fn();
    const update = (fn: (value: Db) => Db) => { db = fn(db); return true; };

    await act(async () =>
      root.render(
        <GoalDetailView db={db} goalId="goal-1" update={update} onCompleted={onCompleted} t={t} lang="fa" cal="jalali" />,
      ),
    );

    expect(db.goals[0].status).toBe("completed");
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it("manually finishes a partial goal without inflating progress or announcing 100 percent", async () => {
    let db = activeDb();
    const item = { id: "half", kind: "custom" as const, title: "مطالعه", measure: "count" as const, value: 5, target: 10 };
    db.goals = [goal({ items: [item] })];
    sessionStorage.removeItem("routino:goal-celebration");
    const onCompleted = vi.fn();
    const update = (fn: (value: Db) => Db) => { db = fn(db); return true; };
    const render = () => root.render(
      <GoalDetailView db={db} goalId="goal-1" update={update} onCompleted={onCompleted} t={t} lang="fa" cal="jalali" />,
    );
    await act(async () => render());
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "اتمام هدف")!.click());
    expect(db.goals[0].status).toBe("active");
    await act(async () => [...document.body.querySelectorAll("button")].find((button) => button.textContent === "تأیید")!.click());
    expect(db.goals[0].status).toBe("completed");
    expect(db.goals[0].items).toEqual([item]);
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(goalProgress(db, db.goals[0]).percent).toBe(50);
    expect(sessionStorage.getItem("routino:goal-celebration")).toBeNull();
    await act(async () => render());
    expect(host.textContent).toContain("۵۰٪");
    expect(host.textContent).toContain("بازکردن دوباره");
  });
});
