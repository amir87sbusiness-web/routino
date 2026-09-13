import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { defaultDb, type Db } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const payments = vi.hoisted(() => ({
  checkoutWithProviderBusyRetry: vi.fn(),
  fetchPlans: vi.fn(),
  fetchQuote: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({ db: null as Db | null, applyEntitlement: vi.fn() }));
const native = vi.hoisted(() => ({ platform: "web", open: vi.fn() }));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => native.platform,
    isNativePlatform: () => native.platform !== "web",
  },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: native.open } }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
}));
vi.mock("@/lib/api/payments", () => payments);
vi.mock("@/lib/api/auth", () => ({ entitlementToSubscription: vi.fn() }));
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({
    db: app.db,
    update: vi.fn(),
    applyEntitlement: app.applyEntitlement,
    t: (fa: string) => fa,
    lang: "fa",
    cal: "jalali",
  }),
}));

import { Route } from "./subscribe";

const SubscribePage = (Route as unknown as { component: () => React.ReactNode }).component;

function paymentButton(host: HTMLElement): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("پرداخت و فعال‌سازی"),
  );
  if (!button) throw new Error("payment button not found");
  return button;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

describe("SubscribePage payment attempts", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    native.platform = "web";
    native.open.mockReset();
    app.db = defaultDb([]);
    app.applyEntitlement.mockReset();
    navigate.mockReset();
    payments.checkoutWithProviderBusyRetry.mockReset();
    payments.fetchQuote.mockReset();
    payments.fetchPlans.mockReset().mockResolvedValue({
      plans: [
        {
          id: "m6",
          nameFa: "شش‌ماهه",
          nameEn: "6 Months",
          months: 6,
          price: 999_000,
          originalPrice: null,
        },
        {
          id: "m1",
          nameFa: "یک‌ماهه",
          nameEn: "1 Month",
          months: 1,
          price: 199_000,
          originalPrice: null,
        },
        {
          id: "m3",
          nameFa: "سه‌ماهه",
          nameEn: "3 Months",
          months: 3,
          price: 549_000,
          originalPrice: null,
        },
      ],
      offer: null,
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<SubscribePage />);
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("blocks two clicks before React can render the disabled state", async () => {
    let release!: (value: unknown) => void;
    payments.checkoutWithProviderBusyRetry.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const button = paymentButton(host);

    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    expect(payments.checkoutWithProviderBusyRetry).toHaveBeenCalledTimes(1);
    await act(async () => release({ free: false, paymentId: "payment-1" }));
  });

  it("keeps plan cards visible while only price numbers load and defaults to three months", async () => {
    payments.fetchPlans.mockReset().mockReturnValue(new Promise(() => undefined));
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => {
      root.render(<SubscribePage />);
      await Promise.resolve();
    });

    const choices = [...host.querySelectorAll<HTMLButtonElement>("[data-plan-id]")];
    expect(choices.map((choice) => choice.dataset.planId)).toEqual(["m1", "m3", "m6"]);
    expect(
      choices.find((choice) => choice.dataset.planId === "m3")?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(host.querySelectorAll('[data-price-loading="true"]')).toHaveLength(3);
    expect(host.textContent).not.toContain("در حال دریافت قیمت‌های جدید");
  });

  it("renders plans in fixed order without savings copy", () => {
    const choices = [...host.querySelectorAll<HTMLButtonElement>("[data-plan-id]")];
    expect(choices.map((choice) => choice.dataset.planId)).toEqual(["m1", "m3", "m6"]);
    expect(choices[1]?.textContent).toContain("۵۴۹,۰۰۰");
    expect(choices[2]?.textContent).toContain("۹۹۹,۰۰۰");
    expect(host.textContent).not.toContain("تومان به‌صرفه‌تر");
  });

  it("applies one code to every eligible plan and keeps ineligible plans unchanged", async () => {
    payments.fetchQuote.mockImplementation(async (planId: string) => {
      const quotes = {
        m1: {
          quote: {
            planId: "m1",
            months: 1,
            basePriceToman: 199_000,
            discountPercent: 50,
            discountAmountToman: 0,
            discountCode: "MINIMAL20",
            finalToman: 99_500,
          },
          discount: { valid: true, percent: 50, amountToman: 0, code: "MINIMAL20" },
        },
        m3: {
          quote: {
            planId: "m3",
            months: 3,
            basePriceToman: 549_000,
            discountPercent: 20,
            discountAmountToman: 0,
            discountCode: "MINIMAL20",
            finalToman: 439_200,
          },
          discount: { valid: true, percent: 20, amountToman: 0, code: "MINIMAL20" },
        },
        m6: {
          quote: {
            planId: "m6",
            months: 6,
            basePriceToman: 999_000,
            discountPercent: 0,
            discountAmountToman: 0,
            discountCode: null,
            finalToman: 999_000,
          },
          discount: {
            valid: false,
            percent: 0,
            amountToman: 0,
            code: null,
            reason: "not_applicable",
          },
        },
      } as const;
      return quotes[planId as keyof typeof quotes];
    });

    const input = host.querySelector<HTMLInputElement>('input[placeholder="کد تخفیف"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "MINIMAL20",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const apply = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("اعمال"),
    )!;
    await click(apply);

    expect(host.querySelector<HTMLElement>('[data-plan-id="m1"]')?.textContent).toContain("۹۹,۵۰۰");
    expect(host.querySelector<HTMLElement>('[data-plan-id="m3"]')?.textContent).toContain(
      "۴۳۹,۲۰۰",
    );
    expect(host.querySelector<HTMLElement>('[data-plan-id="m6"]')?.textContent).toContain(
      "۹۹۹,۰۰۰",
    );
    expect(payments.fetchQuote).toHaveBeenCalledTimes(3);
    expect(host.textContent).not.toContain("کد MINIMAL20 اعمال شد");
  });

  it("reuses one UUID after a retryable timeout", async () => {
    payments.checkoutWithProviderBusyRetry
      .mockRejectedValueOnce(new ApiError(504, "payment_network_timeout", "safe"))
      .mockResolvedValueOnce({ free: false, paymentId: "payment-1" });

    await click(paymentButton(host));
    await click(paymentButton(host));

    expect(payments.checkoutWithProviderBusyRetry).toHaveBeenCalledTimes(2);
    const firstAttempt = payments.checkoutWithProviderBusyRetry.mock.calls[0]?.[3];
    const secondAttempt = payments.checkoutWithProviderBusyRetry.mock.calls[1]?.[3];
    expect(firstAttempt).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondAttempt).toBe(firstAttempt);
  });

  it("keeps the UUID when the same attempt is still being processed", async () => {
    payments.checkoutWithProviderBusyRetry
      .mockRejectedValueOnce(new ApiError(409, "duplicate_payment_attempt", "safe"))
      .mockResolvedValueOnce({ free: false, paymentId: "payment-1" });

    await click(paymentButton(host));
    await click(paymentButton(host));

    expect(payments.checkoutWithProviderBusyRetry.mock.calls[1]?.[3]).toBe(
      payments.checkoutWithProviderBusyRetry.mock.calls[0]?.[3],
    );
  });

  it("creates a new UUID when the selected plan changes", async () => {
    payments.checkoutWithProviderBusyRetry
      .mockRejectedValueOnce(new ApiError(503, "payment_provider_unavailable", "safe"))
      .mockResolvedValueOnce({ free: false, paymentId: "payment-2" });

    await click(paymentButton(host));
    const oneMonth = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("یک‌ماهه"),
    )!;
    await click(oneMonth);
    await click(paymentButton(host));

    expect(payments.checkoutWithProviderBusyRetry.mock.calls[1]?.[3]).not.toBe(
      payments.checkoutWithProviderBusyRetry.mock.calls[0]?.[3],
    );
  });

  it("releases the UUID after a definitive ZarinPal rejection", async () => {
    payments.checkoutWithProviderBusyRetry
      .mockRejectedValueOnce(new ApiError(400, "psp_failed", "safe"))
      .mockResolvedValueOnce({ free: false, paymentId: "payment-3" });

    await click(paymentButton(host));
    await click(paymentButton(host));

    expect(payments.checkoutWithProviderBusyRetry.mock.calls[1]?.[3]).not.toBe(
      payments.checkoutWithProviderBusyRetry.mock.calls[0]?.[3],
    );
    expect(host.textContent).not.toContain("safe");
  });

  it("opens the bank in a native browser on Android", async () => {
    native.platform = "android";
    payments.checkoutWithProviderBusyRetry.mockResolvedValue({
      free: false,
      paymentId: "payment-native",
      paymentUrl: "https://payment.zarinpal.com/pg/StartPay/A1",
    });

    await click(paymentButton(host));

    expect(native.open).toHaveBeenCalledWith({
      url: "https://payment.zarinpal.com/pg/StartPay/A1",
    });
  });
});
