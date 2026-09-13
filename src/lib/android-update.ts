/** Android-only, low-frequency check for a newer APK on Routino's own site. */
export const ANDROID_UPDATE_FEED_URL = "https://routino.me/app/android-update.json";
export const ANDROID_DOWNLOAD_SECTION_URL = "https://routino.me/#get";
export const ANDROID_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const LAST_CHECK_KEY = "routino:android-update:last-check:v1";

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ReleaseResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export interface AndroidUpdateDriver {
  isAndroid(): Promise<boolean>;
  currentBuild(): Promise<string>;
  fetchRelease(): Promise<ReleaseResponse>;
  storage: KeyValueStorage;
  now(): number;
}

export interface AndroidUpdate {
  versionCode: number;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function releaseFrom(value: unknown): AndroidUpdate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const versionCode = positiveInteger((value as { versionCode?: unknown }).versionCode);
  return versionCode ? { versionCode } : null;
}

function lastCheck(storage: KeyValueStorage): { available: boolean; value: number | null } {
  try {
    return { available: true, value: positiveInteger(storage.getItem(LAST_CHECK_KEY)) };
  } catch {
    return { available: false, value: null };
  }
}

function recordCheck(storage: KeyValueStorage, at: number): boolean {
  try {
    storage.setItem(LAST_CHECK_KEY, String(at));
    return true;
  } catch {
    return false;
  }
}

/** Returns a newer release only after the local 24-hour cooldown has elapsed. */
export async function checkAndroidUpdate(
  driver: AndroidUpdateDriver,
): Promise<AndroidUpdate | null> {
  if (!(await driver.isAndroid())) return null;

  const now = driver.now();
  const previous = lastCheck(driver.storage);
  if (!previous.available) return null;
  if (
    previous.value !== null &&
    (previous.value > now || now - previous.value < ANDROID_UPDATE_CHECK_INTERVAL_MS)
  ) {
    return null;
  }

  if (!recordCheck(driver.storage, now)) return null;
  const currentVersion = positiveInteger(await driver.currentBuild());
  if (!currentVersion) return null;

  try {
    const response = await driver.fetchRelease();
    if (!response.ok) return null;
    const release = releaseFrom(await response.json());
    return release && release.versionCode > currentVersion ? release : null;
  } catch {
    return null;
  }
}

function browserStorage(): KeyValueStorage {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  };
}

/** Starts an Android-only check. Web and iOS never request the release feed. */
export async function checkAndroidUpdateOnBoot(): Promise<AndroidUpdate | null> {
  const { Capacitor } = await import("@capacitor/core");
  return checkAndroidUpdate({
    isAndroid: async () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android",
    currentBuild: async () => {
      const { App } = await import("@capacitor/app");
      return (await App.getInfo()).build;
    },
    fetchRelease: () => fetch(ANDROID_UPDATE_FEED_URL, { cache: "no-store" }),
    storage: browserStorage(),
    now: () => Date.now(),
  });
}

/** The button destination is fixed in the app and cannot be changed by the feed. */
export async function openAndroidUpdatePage(): Promise<void> {
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: ANDROID_DOWNLOAD_SECTION_URL });
}
