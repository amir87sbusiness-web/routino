import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replayGuide, readGuide } from "@/lib/product-guide";
import { GuideOverlay, HelpHint } from "./ProductGuide";

vi.mock("@/state/app", () => ({ useAppMaybe: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("contextual guide", () => {
  let host: HTMLDivElement;
  let root: Root;
  const page = (owner = "a", modal = false) => (
    <>
      <div data-guide-scope="today">
        <div data-guide="intro">Today</div>
        <div data-guide="date">Date</div>
        <div data-guide="habits">Habits</div>
        <div data-guide="tasks">Tasks</div>
        <div data-guide="navigation">Navigation</div>
        <HelpHint topic="pomodoro" />
      </div>
      {modal && (
        <div data-guide-modal data-guide-scope="habit-form">
          <div data-guide="name">Name</div>
          <div data-guide="measurement">Measurement</div>
          <div data-guide="repeat">Repeat</div>
          <div data-guide="monthly">Monthly</div>
          <div data-guide="save">Save</div>
        </div>
      )}
      <GuideOverlay owner={owner} lang="fa" />
    </>
  );
  const render = async (node: React.ReactNode) => {
    await act(async () => {
      root.render(node);
    });
  };
  const click = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === label || b.getAttribute("aria-label") === label,
    )!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
  };
  beforeEach(() => {
    localStorage.clear();
    replayGuide("a");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 100,
      top: 100,
      bottom: 150,
      left: 20,
      right: 300,
      width: 280,
      height: 50,
      toJSON: () => ({}),
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("walks through Goals and keeps X completion until replay", async () => {
    const goalsPage = (
      <>
        <div data-guide-scope="goals">
          {["intro", "create", "summary", "filters", "list"].map((id) => (
            <div key={id} data-guide={id}>
              {id}
            </div>
          ))}
        </div>
        <GuideOverlay owner="a" lang="fa" />
      </>
    );
    await render(goalsPage);
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain("هدف‌ها");
    for (let i = 0; i < 4; i++) await click("بعدی");
    await click("بستن راهنما");
    expect(readGuide("a").progress.goals).toEqual({ step: "list", done: true });
    await render(<></>);
    await render(goalsPage);
    expect(document.querySelector("[data-guide-card]")).toBeNull();
    await act(async () => replayGuide("a"));
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain("هدف‌ها");
  });

  it("keeps a section closed after X across visits and remounts until replay", async () => {
    await render(page());
    await click("بعدی");
    await click("بستن راهنما");
    expect(document.querySelector("[data-guide-card]")).toBeNull();
    await render(<GuideOverlay owner="a" lang="fa" />);
    await render(page());
    expect(document.querySelector("[data-guide-card]")).toBeNull();
    expect(readGuide("a").progress.today.step).toBe("date");
    expect(readGuide("a").progress.today.done).toBe(true);
    expect(readGuide("a").progress["habit-form"]).toBeUndefined();
    expect(readGuide("b").progress).toEqual({});
    await render(<></>);
    await render(page());
    expect(document.querySelector("[data-guide-card]")).toBeNull();
    await act(async () => replayGuide("a"));
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain(
      "اینجا نمای روز توست",
    );
  });

  it("marks completion and leaves existing accounts alone", async () => {
    await render(page());
    for (let i = 0; i < 4; i++) await click("بعدی");
    await click("فهمیدم");
    expect(readGuide("a").progress.today.done).toBe(true);
    await render(page("existing"));
    expect(document.querySelector("[data-guide-card]")).toBeNull();
    await click("راهنمای پومودورو");
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain("۲۵ دقیقه");
  });

  it("gives forms priority and returns to the unchanged page step", async () => {
    await render(page());
    await click("بعدی");
    await render(page("a", true));
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain("نام و دسته");
    await render(page());
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain(
      "از این نوار روز را انتخاب کن",
    );
  });

  it("pauses for help, restores focus, and consumes an outside click", async () => {
    await render(page());
    const hint = document.querySelector<HTMLButtonElement>("[data-help-hint]")!;
    hint.focus();
    await click("راهنمای پومودورو");
    const underlying = vi.fn();
    host.addEventListener("click", underlying);
    await act(async () =>
      document
        .querySelector('[data-guide="date"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(underlying).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(hint);
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain(
      "اینجا نمای روز توست",
    );
  });

  it("drops page help when another modal opens", async () => {
    await render(page());
    await click("راهنمای پومودورو");
    await render(page("a", true));
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain("نام و دسته");
    expect(document.querySelectorAll("[data-guide-card]")).toHaveLength(1);
  });

  it("skips missing conditional fields and never edits the form", async () => {
    await render(
      <>
        <div data-guide-modal data-guide-scope="task-form">
          <div data-guide="name">Name</div>
          <div data-guide="measurement">Measurement</div>
          <input defaultValue="unchanged" />
          <div data-guide="reminder">Reminder</div>
          <div data-guide="save">Save</div>
        </div>
        <GuideOverlay owner="a" lang="en" />
      </>,
    );
    await click("Next");
    await click("Next");
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain(
      "Reminder and deadline",
    );
    expect(host.querySelector("input")?.value).toBe("unchanged");
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector("[data-guide-card]")).toBeNull();
    expect(readGuide("a").progress["task-form"].step).toBe("reminder");
  });

  it("replays completed sections during the same visit", async () => {
    await render(page());
    for (let i = 0; i < 4; i++) await click("بعدی");
    await click("فهمیدم");
    await act(async () => replayGuide("a"));
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain(
      "اینجا نمای روز توست",
    );
  });

  it("keeps only the dismissed analytics tab closed", async () => {
    const analytics = (tab: string) => (
      <>
        <div data-guide-scope={tab}>
          <div data-guide="weekly">Weekly</div>
          <div data-guide="overall">Overall</div>
          <div data-guide="individual">Individual</div>
          <div data-guide="list">List</div>
        </div>
        <GuideOverlay owner="a" lang="fa" />
      </>
    );
    await render(analytics("analytics-habits"));
    await click("بعدی");
    await click("بستن راهنما");
    await render(analytics("analytics-tasks"));
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain("عملکرد کارها جدا");
    await render(analytics("analytics-habits"));
    expect(document.querySelector("[data-guide-card]")).toBeNull();
  });

  it("shows one-step modal guides anchored on the modal itself", async () => {
    await render(
      <>
        <div data-guide-modal data-guide-scope="category" data-guide="intro">
          Category
        </div>
        <GuideOverlay owner="a" lang="fa" />
      </>,
    );
    expect(document.querySelector("[data-guide-card]")?.textContent).toContain(
      "برای دسته یک نام انتخاب کن",
    );
    await click("فهمیدم");
    expect(readGuide("a").progress.category.done).toBe(true);
  });
});
