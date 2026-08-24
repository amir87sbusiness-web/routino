import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { defaultDb, type Db } from "@/lib/store";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const payments = vi.hoisted(() => ({
  checkout: vi.fn(),
  fetchPlans: vi.fn(),
  fetchQuote: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({ db: null as Db | null, applyEntitlement: vi.fn() }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "web" },
}));
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
    app.db = defaultDb([]);
    app.applyEntitlement.mockReset();
    navigate.mockReset();
    payments.checkout.mockReset();
    payments.fetchQuote.mockReset();
    payments.fetchPlans.mockReset().mockResolvedValue({
      plans: [
        { id: "m1", nameFa: "یک‌ماهه", nameEn: "1 Month", months: 1, price: 59_000 },
        { id: "m3", nameFa: "سه‌ماهه", nameEn: "3 Months", months: 3, price: 149_000 },
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
    payments.checkout.mockReturnValue(
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

    expect(payments.checkout).toHaveBeenCalledTimes(1);
    await act(async () => release({ free: false, paymentId: "payment-1" }));
  });

  it("reuses one UUID after a retryable timeout", async () => {
    payments.checkout
      .mockRejectedValueOnce(new ApiError(504, "payment_network_timeout", "safe"))
      .mockResolvedValueOnce({ free: false, paymentId: "payment-1" });

    await click(paymentButton(host));
    await click(paymentButton(host));

    expect(payments.checkout).toHaveBeenCalledTimes(2);
    const firstAttempt = payments.checkout.mock.calls[0]?.[3];
    const secondAttempt = payments.checkout.mock.calls[1]?.[3];
    expect(firstAttempt).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondAttempt).toBe(firstAttempt);
  });

  it("creates a new UUID when the selected plan changes", async () => {
    payments.checkout
      .mockRejectedValueOnce(new ApiError(503, "payment_provider_unavailable", "safe"))
      .mockResolvedValueOnce({ free: false, paymentId: "payment-2" });

    await click(paymentButton(host));
    const oneMonth = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("یک‌ماهه"),
    )!;
    await click(oneMonth);
    await click(paymentButton(host));

    expect(payments.checkout.mock.calls[1]?.[3]).not.toBe(
      payments.checkout.mock.calls[0]?.[3],
    );
  });

  it("releases the UUID after a definitive token rejection", async () => {
    payments.checkout
      .mockRejectedValueOnce(new ApiError(502, "nextpay_token_error", "safe"))
      .mockResolvedValueOnce({ free: false, paymentId: "payment-3" });

    await click(paymentButton(host));
    await click(paymentButton(host));

    expect(payments.checkout.mock.calls[1]?.[3]).not.toBe(
      payments.checkout.mock.calls[0]?.[3],
    );
    expect(host.textContent).not.toContain("safe");
  });
});
