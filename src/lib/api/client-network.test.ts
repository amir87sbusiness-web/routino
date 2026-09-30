import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ native: false, request: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => platform.native },
  CapacitorHttp: { request: platform.request },
}));
vi.mock("../diagnostics", () => ({ recordDiagnostic: vi.fn() }));
import { apiRequest } from "./client";

beforeEach(() => {
  platform.native = false;
  platform.request.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("API transport failures", () => {
  it("keeps a slow payment alive with its explicit deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => resolve(new Response('{"ok":true}')), 16_000);
            options.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );
    const request = apiRequest("/payments/checkout", { method: "POST", timeoutMs: 35_000 });
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(request).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a deadline from a lost connection without retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );
    const result = apiRequest("/plans").catch((error) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await result).toMatchObject({ code: "timeout", offline: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps native timeout errors distinct from offline errors", async () => {
    platform.native = true;
    platform.request.mockRejectedValue(new Error("java.net.SocketTimeoutException: timeout"));
    await expect(apiRequest("/plans")).rejects.toMatchObject({ code: "timeout", offline: true });
  });

  it("passes the payment deadline to both native timeouts", async () => {
    platform.native = true;
    platform.request.mockResolvedValue({ status: 200, data: { ok: true }, headers: {} });
    await expect(
      apiRequest("/payments/checkout", { method: "POST", timeoutMs: 35_000 }),
    ).resolves.toEqual({ ok: true });
    expect(platform.request).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ connectTimeout: 35_000, readTimeout: 35_000 }),
    );
  });

  it("identifies an HTML native proxy response", async () => {
    platform.native = true;
    platform.request.mockResolvedValue({ status: 502, data: "<html>gateway</html>", headers: {} });
    await expect(apiRequest("/plans")).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
      offline: false,
    });
  });

  it("identifies an HTML proxy response without calling it an offline device", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>gateway</html>", { status: 502 })),
    );
    await expect(apiRequest("/plans")).rejects.toMatchObject({
      code: "invalid_response",
      status: 502,
      offline: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not send a request whose caller already canceled it", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const controller = new AbortController();
    controller.abort();
    await expect(
      apiRequest("/payments/checkout", { signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
