import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, NoteField } from "./ui";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Modal mobile keyboard visibility", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    host.remove();
    document.body.innerHTML = "";
  });

  it("constrains the sheet to the visual viewport while a keyboard covers the screen", async () => {
    const viewport = Object.assign(new EventTarget(), { height: 420, offsetTop: 12, scale: 1 });
    vi.stubGlobal("visualViewport", viewport);
    vi.stubGlobal("innerHeight", 800);
    const root = createRoot(host);
    await act(async () => root.render(
      <Modal open onClose={() => undefined} title="ویرایش">
        <textarea aria-label="توضیحات" />
      </Modal>,
    ));
    const field = document.body.querySelector("textarea")!;
    await act(async () => {
      field.focus();
      viewport.dispatchEvent(new Event("resize"));
    });
    const sheet = field.closest("[role='dialog']") as HTMLElement;
    expect(sheet).toBeTruthy();
    expect(parseFloat(sheet.style.maxHeight)).toBeLessThanOrEqual(viewport.height);
    expect(sheet.parentElement!.style.height).toBe("420px");
    expect(sheet.parentElement!.style.top).toBe("12px");
    await act(async () => {
      viewport.height = 800;
      viewport.offsetTop = 0;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(sheet.style.maxHeight).toBe("");
    await act(async () => root.unmount());
  });

  it("scrolls a focused field into the visible modal area after the keyboard opens", async () => {
    const root = createRoot(host);
    const scrollIntoView = vi.fn();
    await act(async () => {
      root.render(
        <Modal open onClose={() => undefined} title="ویرایش">
          <textarea aria-label="توضیحات" />
        </Modal>,
      );
    });
    const field = document.body.querySelector('textarea[aria-label="توضیحات"]') as HTMLTextAreaElement;
    Object.defineProperty(field, "scrollIntoView", { value: scrollIntoView });

    await act(async () => {
      field.focus();
      vi.advanceTimersByTime(350);
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    await act(async () => root.unmount());
  });

  it("stays above the keyboard when the layout viewport also shrinks", async () => {
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    vi.stubGlobal("visualViewport", viewport);
    vi.stubGlobal("innerHeight", 800);
    const root = createRoot(host);
    await act(async () => root.render(
      <Modal open onClose={() => undefined} title="یادداشت">
        <textarea />
      </Modal>,
    ));
    const field = document.body.querySelector("textarea")!;
    await act(async () => {
      field.focus();
      vi.stubGlobal("innerHeight", 420);
      viewport.height = 420;
      viewport.dispatchEvent(new Event("resize"));
    });
    const sheet = field.closest('[role="dialog"]') as HTMLElement;
    expect(sheet.parentElement!.style.height).toBe("420px");
    expect(sheet.parentElement!.style.alignItems).toBe("flex-end");
    expect(parseFloat(sheet.style.maxHeight)).toBeLessThanOrEqual(420);
    await act(async () => {
      vi.stubGlobal("innerHeight", 800);
      viewport.height = 800;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(sheet.style.maxHeight).toBe("");
    await act(async () => root.unmount());
  });

  it("does not treat pinch zoom or a focused action as a keyboard", async () => {
    const viewport = Object.assign(new EventTarget(), { height: 420, offsetTop: 12, scale: 2 });
    vi.stubGlobal("visualViewport", viewport);
    vi.stubGlobal("innerHeight", 800);
    const root = createRoot(host);
    await act(async () => root.render(
      <Modal open onClose={() => undefined} title="ویرایش">
        <textarea />
        <button data-action>ذخیره</button>
      </Modal>,
    ));
    const field = document.body.querySelector("textarea")!;
    const sheet = field.closest("[role='dialog']") as HTMLElement;
    await act(async () => {
      field.focus();
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(sheet.style.maxHeight).toBe("");
    await act(async () => {
      viewport.scale = 1;
      (document.body.querySelector("[data-action]") as HTMLElement).focus();
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(sheet.style.maxHeight).toBe("");
    await act(async () => root.unmount());
  });

  it("does not mistake rotation before opening a sheet for a keyboard", async () => {
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    vi.stubGlobal("visualViewport", viewport);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("innerWidth", 390);
    const root = createRoot(host);
    const render = (open: boolean) => root.render(
      <Modal open={open} onClose={() => undefined} title="یادداشت"><textarea autoFocus /></Modal>,
    );
    await act(async () => render(false));
    await act(async () => {
      vi.stubGlobal("innerWidth", 800);
      vi.stubGlobal("innerHeight", 390);
      viewport.height = 390;
      render(true);
    });
    const sheet = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(sheet.style.maxHeight).toBe("");
    await act(async () => root.unmount());
  });

  it("opens a compact mobile note editor above the keyboard and preserves the draft", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 800);
    const viewport = Object.assign(new EventTarget(), { height: 420, offsetTop: 0, scale: 1 });
    vi.stubGlobal("visualViewport", viewport);
    const root = createRoot(host);
    let value = "متن قبلی";
    const render = () => root.render(<NoteField label="یادداشت کوتاه" doneLabel="ذخیره" value={value} onChange={(next) => { value = next; render(); }} />);
    await act(async () => render());
    expect((host.querySelector("input") as HTMLInputElement).className).toContain("text-base");
    await act(async () => (host.querySelector("input") as HTMLInputElement).focus());
    const editor = document.body.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    expect(editor.value).toBe("متن قبلی");
    expect(document.activeElement).toBe(editor);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "متن جدید");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      viewport.dispatchEvent(new Event("resize"));
    });
    const sheet = editor.closest('[role="dialog"]') as HTMLElement;
    expect(sheet.parentElement!.style.height).toBe("420px");
    expect(editor.className).toContain("h-28");
    await act(async () => [...document.body.querySelectorAll("button")].find((button) => button.textContent === "ذخیره")!.click());
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("متن جدید");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it.each([false, true])("keeps typing inline on a narrow screen without a virtual keyboard (touch: %s)", async (touch) => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("matchMedia", () => ({ matches: touch }));
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    vi.stubGlobal("visualViewport", viewport);
    const root = createRoot(host);
    let value = "";
    const render = () => root.render(<NoteField multiline label="یادداشت" doneLabel="ذخیره" value={value} onChange={(next) => { value = next; render(); }} />);
    await act(async () => render());
    const field = host.querySelector("textarea")!;
    await act(async () => field.focus());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "نوشته با کیبورد فیزیکی");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(field.value).toBe("نوشته با کیبورد فیزیکی");
    expect(document.activeElement).toBe(field);
    await act(async () => root.unmount());
  });

  it("opens the touch note sheet only after the virtual keyboard reduces the viewport", async () => {
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    vi.stubGlobal("visualViewport", viewport);
    const root = createRoot(host);
    await act(async () => root.render(<NoteField label="یادداشت" doneLabel="ذخیره" value="متن قبلی" onChange={() => undefined} />));
    await act(async () => (host.querySelector("input") as HTMLInputElement).focus());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      viewport.height = 420;
      viewport.dispatchEvent(new Event("resize"));
    });
    const editor = document.body.querySelector('[role="dialog"] textarea') as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    expect(editor.value).toBe("متن قبلی");
    expect(document.activeElement).toBe(editor);
    await act(async () => root.unmount());
  });
});
