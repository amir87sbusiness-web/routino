import { describe, expect, it, vi } from "vitest";
import {
  ANDROID_UPDATE_CHECK_INTERVAL_MS,
  checkAndroidUpdate,
  type AndroidUpdateDriver,
} from "./android-update";

function driver(overrides: Partial<AndroidUpdateDriver> = {}): AndroidUpdateDriver {
  return {
    isAndroid: async () => true,
    currentBuild: async () => "9",
    now: () => 100_000_000,
    fetchRelease: async () => ({ ok: true, json: async () => ({ versionCode: 10 }) }),
    storage: memory(),
    ...overrides,
  };
}

describe("Android in-app update checks", () => {
  it("returns a newer Android release from Routino's own version endpoint", async () => {
    await expect(checkAndroidUpdate(driver())).resolves.toEqual({ versionCode: 10 });
  });

  it("does not request the version endpoint again during the 24-hour local cooldown", async () => {
    const fetchRelease = vi.fn(async () => ({ ok: true, json: async () => ({ versionCode: 10 }) }));
    const storage = memory({
      "routino:android-update:last-check:v1": String(
        100_000_000 - ANDROID_UPDATE_CHECK_INTERVAL_MS + 1,
      ),
    });

    await expect(checkAndroidUpdate(driver({ fetchRelease, storage }))).resolves.toBeNull();
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it("ignores web, malformed responses, and releases that are not newer", async () => {
    await expect(checkAndroidUpdate(driver({ isAndroid: async () => false }))).resolves.toBeNull();
    await expect(
      checkAndroidUpdate(
        driver({ fetchRelease: async () => ({ ok: true, json: async () => ({}) }) }),
      ),
    ).resolves.toBeNull();
    await expect(
      checkAndroidUpdate(
        driver({
          fetchRelease: async () => ({ ok: true, json: async () => ({ versionCode: 9 }) }),
        }),
      ),
    ).resolves.toBeNull();
  });
});

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
