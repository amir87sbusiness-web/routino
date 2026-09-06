import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { request: native.request },
}));
vi.mock("../diagnostics", () => ({ recordDiagnostic: vi.fn() }));

import { ApiError, apiRequest } from "./client";

describe("native API cancellation", () => {
  beforeEach(() => {
    native.request.mockReset();
  });

  it("rejects an aborted request before a late native response can reach the caller", async () => {
    let finishNative!: (value: { status: number; data: unknown; headers: object }) => void;
    native.request.mockReturnValue(
      new Promise((resolve) => {
        finishNative = resolve;
      }),
    );
    const controller = new AbortController();
    const request = apiRequest<{ ok: boolean }>("/payments/checkout", {
      method: "POST",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(native.request).toHaveBeenCalledOnce());
    const observed = request.then(
      () => "resolved",
      (err) => (err instanceof ApiError && err.code === "offline" ? "aborted" : "wrong-error"),
    );

    controller.abort();
    const earlyOutcome = await Promise.race([
      observed,
      new Promise<"still-pending">((resolve) => setTimeout(() => resolve("still-pending"), 50)),
    ]);
    finishNative({ status: 200, data: { ok: true }, headers: {} });
    await observed;

    expect(earlyOutcome).toBe("aborted");
  });
});
