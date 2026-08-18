import { beforeEach, describe, expect, it } from "vitest";
import { DEVICE_KEY_STORAGE, getOrCreateDeviceDescriptor } from "./device-identity";

beforeEach(() => localStorage.clear());

describe("device identity", () => {
  it("keeps one cryptographic installation key across calls", async () => {
    const first = await getOrCreateDeviceDescriptor();
    const second = await getOrCreateDeviceDescriptor();
    expect(first.installationKey).toBe(second.installationKey);
    expect(first.installationKey.length).toBeGreaterThanOrEqual(32);
    expect(localStorage.getItem(DEVICE_KEY_STORAGE)).toBe(first.installationKey);
  });

  it("does not depend on network address or VPN state", async () => {
    const before = await getOrCreateDeviceDescriptor();
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    const after = await getOrCreateDeviceDescriptor();
    expect(after.installationKey).toBe(before.installationKey);
  });

  it("returns bounded presentation fields instead of a raw user agent", async () => {
    const descriptor = await getOrCreateDeviceDescriptor();
    expect(["web", "pwa", "android", "ios"]).toContain(descriptor.platform);
    expect(descriptor.name.length).toBeLessThanOrEqual(64);
    expect(descriptor.browser?.length ?? 0).toBeLessThanOrEqual(32);
    expect(descriptor.os?.length ?? 0).toBeLessThanOrEqual(32);
    expect(descriptor.name).not.toBe(navigator.userAgent);
  });
});
