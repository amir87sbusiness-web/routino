import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultDb } from "@/lib/store";

const test = vi.hoisted(() => ({
  platform: "android",
  search: { paymentId: "payment-1", status: "paid" },
  db: null as unknown,
  apply: vi.fn(),
  fetch: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => test.platform } }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({ ...options, useSearch: () => test.search }),
  useNavigate: () => test.navigate,
}));
vi.mock("@/state/app", () => ({
  useAppMaybe: () => ({
    db: test.db,
    applyEntitlement: test.apply,
    t: (fa: string) => fa,
    lang: "fa",
  }),
}));
vi.mock("@/lib/api/payments", () => ({ fetchPayment: test.fetch }));
vi.mock("@/lib/api/auth", () => ({
  hasSession: () => true,
  entitlementToSubscription: (e: unknown) => e,
}));
import { Route } from "./pay.result";
const Page = (Route as unknown as { component: () => React.ReactNode }).component;
let host: HTMLDivElement;
let root: Root;
const paid = {
  payment: { id: "payment-1", status: "paid", months: 1 },
  entitlement: { planId: "m1", expiresAt: Date.now() + 86400000 },
};
async function render() {
  await act(async () => {
    root.render(<Page />);
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  test.platform = "android";
  test.search = { paymentId: "payment-1", status: "paid" };
  test.db = defaultDb([]);
  test.apply.mockReset();
  test.navigate.mockReset();
  test.fetch.mockReset().mockResolvedValue(paid);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("waits for cold-start hydration then applies server entitlement before Home", async () => {
  test.db = null;
  await render();
  expect(test.fetch).not.toHaveBeenCalled();
  test.db = defaultDb([]);
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(test.fetch).toHaveBeenCalledTimes(1);
  expect(test.apply).toHaveBeenCalledWith(paid.entitlement);
  expect(test.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
});

it("never offers success from a forged deep-link hint while the server is pending", async () => {
  test.fetch.mockResolvedValue({ ...paid, payment: { ...paid.payment, status: "pending" } });
  await render();
  expect(host.textContent).not.toContain("شروع روتینو");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(90000);
  });
  expect(test.fetch).toHaveBeenCalledTimes(5);
  expect(test.apply).not.toHaveBeenCalled();
  expect(test.navigate).not.toHaveBeenCalled();
});

it("resets confirmation when a second payment returns on the same mounted screen", async () => {
  await render();
  test.search = { paymentId: "payment-2", status: "paid" };
  test.fetch.mockResolvedValue({
    ...paid,
    payment: { ...paid.payment, id: "payment-2", status: "canceled" },
  });
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(test.navigate).not.toHaveBeenCalled();
  expect(host.textContent).toContain("پرداخت لغو شد");
});

it("keeps Web on its result screen after server-confirmed success", async () => {
  test.platform = "web";
  await render();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(test.apply).toHaveBeenCalledTimes(1);
  expect(test.navigate).not.toHaveBeenCalled();
});
