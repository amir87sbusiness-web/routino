import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const app = vi.hoisted(() => ({
  submitFeedback: vi.fn(),
  t: (fa: string) => fa,
}));
const browser = vi.hoisted(() => ({ open: vi.fn() }));
const capacitor = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => true) }));
const externalWindow = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("@/state/app", () => ({ useApp: () => app }));
vi.mock("@capacitor/browser", () => ({ Browser: browser }));
vi.mock("@capacitor/core", () => ({ Capacitor: capacitor }));

import { FeedbackModal } from "./FeedbackModal";

describe("FeedbackModal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    app.submitFeedback.mockReset();
    browser.open.mockReset().mockResolvedValue(undefined);
    capacitor.isNativePlatform.mockReset().mockReturnValue(true);
    externalWindow.open.mockReset();
    vi.stubGlobal("open", externalWindow.open);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("opens the prepared feedback in Telegram instead of saving it", async () => {
    await act(async () => root.render(<FeedbackModal open onDone={vi.fn()} />));

    const stars = [...document.querySelectorAll("button")].filter(
      (button) => button.getAttribute("aria-label") === "3 ستاره",
    );
    await act(async () => stars[0].click());
    const section = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "کارها",
    )!;
    await act(async () => section.click());
    const comment = document.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        comment,
        "کارها بهتر شوند",
      );
      comment.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "ثبت نظر",
    )!;
    await act(async () => submit.click());

    expect(browser.open).toHaveBeenCalledWith({
      url: expect.stringContaining("https://t.me/routino_support?text="),
    });
    const url = new URL(browser.open.mock.calls[0][0].url);
    expect(url.searchParams.get("text")).toContain("امتیاز: 3 از 5");
    expect(url.searchParams.get("text")).toContain("بخش: tasks");
    expect(url.searchParams.get("text")).toContain("توضیحات: کارها بهتر شوند");
    expect(app.submitFeedback).not.toHaveBeenCalled();
  });

  it("opens the same prepared Telegram link on the web", async () => {
    capacitor.isNativePlatform.mockReturnValue(false);
    await act(async () => root.render(<FeedbackModal open onDone={vi.fn()} />));

    const star = [...document.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "5 ستاره",
    )!;
    await act(async () => star.click());
    const submit = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "ثبت نظر",
    )!;
    await act(async () => submit.click());

    expect(externalWindow.open).toHaveBeenCalledWith(
      expect.stringContaining("https://t.me/routino_support?text="),
      "_blank",
      "noopener,noreferrer",
    );
    expect(app.submitFeedback).not.toHaveBeenCalled();
  });
});
