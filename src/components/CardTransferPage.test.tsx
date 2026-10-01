import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CardTransferPage } from "./CardTransferPage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const native = vi.hoisted(() => ({ enabled: false, open: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => native.enabled } }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: native.open } }));
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  native.enabled = false;
  native.open.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <CardTransferPage
        details={{
          planName: "سه‌ماهه",
          months: 3,
          basePrice: 449000,
          amount: 359200,
          discountCode: "SAVE20",
          phone: "09120000000",
        }}
        onBack={() => undefined}
        lang="fa"
        t={(fa) => fa}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function button(text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes(text),
  )!;
}

it("copies the raw card digits without showing a message-copy control", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await act(async () => button("کپی شماره کارت").click());
  expect(writeText).toHaveBeenLastCalledWith("6219861490215695");
  expect(host.textContent).not.toContain("کپی متن");
});

it("opens the support chat with a draft on web and native without submitting a message", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  await act(async () => button("ارسال به تلگرام").click());
  const url = new URL(open.mock.calls[0][0] as string);
  expect(url.origin + url.pathname).toBe("https://t.me/routino_support");
  expect(url.searchParams.get("text")).toContain("شماره تلفن: 09120000000");
  expect(url.searchParams.get("text")).toContain("پرداخت کارت به کارت روتینو");
  expect(url.searchParams.get("text")).toContain("359,200 تومان");
  expect(url.searchParams.get("text")).toContain("SAVE20");
  expect(url.searchParams.get("text")).not.toContain("اسکرین‌شات");
  expect(host.querySelector("textarea")).toBeNull();
  expect(open.mock.calls[0].slice(1)).toEqual(["_blank", "noopener,noreferrer"]);
  native.enabled = true;
  await act(async () => button("ارسال به تلگرام").click());
  expect(native.open).toHaveBeenCalledWith({ url: url.href });
});

it("keeps manually selectable values when clipboard access is unavailable", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  await act(async () => button("کپی شماره کارت").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("دستی کپی کن");
  expect(host.querySelector("input")?.readOnly).toBe(true);
  expect(host.querySelector("input")?.value).toBe("6219 8614 9021 5695");
});
