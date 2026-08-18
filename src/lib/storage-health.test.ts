import { afterEach, describe, expect, it, vi } from "vitest";
import { readStorageHealth, requestPersistentStorage } from "./storage-health";

const originalStorage = navigator.storage;

afterEach(() => {
  Object.defineProperty(navigator, "storage", { configurable: true, value: originalStorage });
  vi.restoreAllMocks();
});

function setStorage(value: Partial<StorageManager> | undefined) {
  Object.defineProperty(navigator, "storage", { configurable: true, value });
}

describe("storage health", () => {
  it("reports unsupported browsers without throwing", async () => {
    setStorage(undefined);
    await expect(readStorageHealth()).resolves.toEqual({
      supported: false,
      persisted: false,
      usageBytes: null,
      quotaBytes: null,
    });
  });

  it("returns persistence and quota information", async () => {
    setStorage({
      persisted: vi.fn().mockResolvedValue(true),
      estimate: vi.fn().mockResolvedValue({ usage: 12_000, quota: 50_000 }),
    });
    await expect(readStorageHealth()).resolves.toEqual({
      supported: true,
      persisted: true,
      usageBytes: 12_000,
      quotaBytes: 50_000,
    });
  });

  it("requests persistence only when supported and returns the refreshed state", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    setStorage({
      persist,
      persisted: vi.fn().mockResolvedValue(true),
      estimate: vi.fn().mockResolvedValue({ usage: 1, quota: 2 }),
    });
    const health = await requestPersistentStorage();
    expect(persist).toHaveBeenCalledOnce();
    expect(health.persisted).toBe(true);
  });

  it("turns browser API failures into a safe best-effort state", async () => {
    setStorage({
      persisted: vi.fn().mockRejectedValue(new DOMException("denied")),
      estimate: vi.fn().mockRejectedValue(new DOMException("denied")),
    });
    await expect(readStorageHealth()).resolves.toEqual({
      supported: true,
      persisted: false,
      usageBytes: null,
      quotaBytes: null,
    });
  });
});
