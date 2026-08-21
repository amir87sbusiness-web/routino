import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = vi.hoisted(() => ({
  clearTokens: vi.fn(),
  entitlementToSubscription: vi.fn(() => null),
  importSubscription: vi.fn(),
  passwordLogin: vi.fn(),
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({ switchAccount: vi.fn(), update: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
}));
vi.mock("@/components/ui", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Logo: () => <span>Routino</span>,
}));
vi.mock("@/lib/api/auth", () => api);
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({
    db: { meta: { dataOwner: null }, subscription: null, auth: null },
    update: app.update,
    switchAccount: app.switchAccount,
    t: (fa: string) => fa,
    lang: "fa",
  }),
}));

import { Route } from "./auth";

const AuthPage = (Route as unknown as { component: () => React.ReactNode }).component;

function change(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
}

describe("AuthPage registration and recovery", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    api.requestOtp.mockResolvedValue({ ok: true, retryAfter: 60 });
    api.verifyOtp.mockResolvedValue({
      user: { id: "u1", phone: "989123334444" },
      entitlement: { status: "none", planId: null, expiresAt: null, issuedAt: "now" },
    });
    app.switchAccount.mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<AuthPage />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("shows explicit registration and recovery buttons", () => {
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain(
      "ثبت‌نام",
    );
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toContain(
      "فراموشی رمز عبور",
    );
  });

  it("uses a four-digit code and sends the registration intent", async () => {
    await click(
      [...host.querySelectorAll("button")].find((button) => button.textContent === "ثبت‌نام")!,
    );
    const phone = host.querySelector<HTMLInputElement>('input[placeholder="09xxxxxxxxx"]')!;
    await act(async () => change(phone, "09123334444"));
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "ارسال کد پیامکی",
      )!,
    );

    const code = host.querySelector<HTMLInputElement>('input[aria-label="کد پیامکی"]')!;
    expect(code.maxLength).toBe(4);
    await act(async () => change(code, "12345"));
    expect(code.value).toBe("1234");
    const newPassword = host.querySelector<HTMLInputElement>('input[aria-label="رمز عبور جدید"]')!;
    await act(async () => change(newPassword, "Amir@1387"));
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "تکمیل ثبت‌نام",
      )!,
    );

    expect(api.verifyOtp).toHaveBeenCalledWith("989123334444", "1234", {
      intent: "signup",
      newPassword: "Amir@1387",
    });
    expect(api.importSubscription).not.toHaveBeenCalled();
    expect(app.switchAccount).toHaveBeenCalledWith(
      { id: "u1", phone: "989123334444" },
      { status: "none", planId: null, expiresAt: null, issuedAt: "now" },
    );
  });

  it("sends the password-reset intent only after four digits", async () => {
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "فراموشی رمز عبور",
      )!,
    );
    const phone = host.querySelector<HTMLInputElement>('input[placeholder="09xxxxxxxxx"]')!;
    await act(async () => change(phone, "09123334444"));
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "ارسال کد پیامکی",
      )!,
    );

    const code = host.querySelector<HTMLInputElement>('input[aria-label="کد پیامکی"]')!;
    await act(async () => change(code, "123"));
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "تغییر رمز عبور",
      )!,
    );
    expect(api.verifyOtp).not.toHaveBeenCalled();

    await act(async () => change(code, "1234"));
    const newPassword = host.querySelector<HTMLInputElement>('input[aria-label="رمز عبور جدید"]')!;
    await act(async () => change(newPassword, "Naghmeh@1405"));
    await click(
      [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "تغییر رمز عبور",
      )!,
    );
    expect(api.verifyOtp).toHaveBeenCalledWith("989123334444", "1234", {
      intent: "password_reset",
      newPassword: "Naghmeh@1405",
    });
  });
});
