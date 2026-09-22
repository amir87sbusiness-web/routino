import { beforeEach, describe, expect, it, vi } from "vitest";
import { showLocalWebNotification } from "./local-web-notifications";

describe("showLocalWebNotification", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("is a safe no-op when the browser has no notification support", async () => {
    vi.stubGlobal("Notification", undefined);

    await expect(
      showLocalWebNotification({ id: "task|1", title: "Task", body: "Do it" }),
    ).resolves.toBe("unsupported");
  });

  it("does not request permission and returns denied unless permission is already granted", async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", { permission: "default", requestPermission });

    expect(
      await showLocalWebNotification({ id: "task|1", title: "Task", body: "Do it" }),
    ).toBe("permission-required");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("prefers the service worker registration and deduplicates a delivered id", async () => {
    const showNotification = vi.fn(async () => undefined);
    vi.stubGlobal("Notification", { permission: "granted" });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn(async () => ({ showNotification })) },
    });

    const payload = { id: "journal|2026-09-22|21:00", title: "Journal", body: "Write" };
    expect(await showLocalWebNotification(payload)).toBe("shown");
    expect(await showLocalWebNotification(payload)).toBe("duplicate");
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith("Journal", {
      body: "Write",
      tag: payload.id,
    });
  });

  it("falls back to the window Notification constructor when no registration exists", async () => {
    const notification = vi.fn();
    Object.assign(notification, { permission: "granted" });
    vi.stubGlobal("Notification", notification);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn(async () => undefined) },
    });

    expect(
      await showLocalWebNotification({ id: "timer|1|finished", title: "Routino", body: "Done" }),
    ).toBe("shown");
    expect(notification).toHaveBeenCalledWith("Routino", {
      body: "Done",
      tag: "timer|1|finished",
    });
  });

  it("retries one transient delivery failure without consuming or duplicating the id", async () => {
    const showNotification = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("sleeping worker"))
      .mockResolvedValueOnce(undefined);
    const notification = vi.fn(() => {
      throw new Error("constructor unavailable");
    });
    Object.assign(notification, { permission: "granted" });
    vi.stubGlobal("Notification", notification);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn(async () => ({ showNotification })) },
    });
    const payload = { id: "habit|1|today", title: "Habit", body: "Go" };

    expect(await showLocalWebNotification(payload)).toBe("shown");
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(await showLocalWebNotification(payload)).toBe("duplicate");
  });

  it("keeps permission-required as a no-op without retrying", async () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });

    expect(
      await showLocalWebNotification({ id: "task|blocked", title: "Task", body: "Do it" }),
    ).toBe("permission-required");
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
