/**
 * Progressive-web-app plumbing: service worker, install prompt, durable storage.
 *
 * All of it is web-only and no-ops inside Capacitor, where the assets are
 * already local and a service worker would only cause harm.
 */
import { Capacitor } from "@capacitor/core";

/* ---------------------------------------------------------------- storage --- */

/**
 * Asks the browser not to evict our data.
 *
 * This matters more here than in most apps: IndexedDB is the ONLY copy of the
 * user's personal content. Browsers may evict best-effort storage under pressure;
 * persistence greatly reduces that risk but cannot override an explicit site-data
 * clear, private browsing, or browser/profile removal.
 *
 * Chrome usually grants this once the app is installed or sufficiently engaged;
 * Firefox prompts; Safari grants for installed apps. There is nothing to do when
 * it is refused except know about it.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) return true; // native storage is already durable
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Rough usage report, for a future "storage" row in settings. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ install --- */

/**
 * The event Chrome fires when the app is installable. It must be captured and
 * kept: it can only be `prompt()`ed from a user gesture, and the browser only
 * offers it once per page load.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<(available: boolean) => void>();

const notify = () => installListeners.forEach((fn) => fn(deferredPrompt !== null));

export function watchInstallability(fn: (available: boolean) => void): () => void {
  installListeners.add(fn);
  fn(deferredPrompt !== null);
  return () => installListeners.delete(fn);
}

/** True when the app is already running as an installed app. */
export function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's non-standard flag — the only way to detect it there.
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * iOS has no `beforeinstallprompt` and no programmatic install at all. The only
 * route is Share → Add to Home Screen, so the UI has to say that in words.
 */
export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const evt = deferredPrompt;
  // Single-use: the browser will not let the same event be prompted twice.
  deferredPrompt = null;
  notify();
  await evt.prompt();
  const { outcome } = await evt.userChoice;
  return outcome;
}

/* ------------------------------------------------------------- worker --- */

let onUpdateReady: (() => void) | null = null;
let applyUpdate: (() => Promise<void>) | null = null;

/** Registers the callback the UI uses to offer "a new version is ready". */
export function onNewVersion(fn: () => void): void {
  onUpdateReady = fn;
}

/** Activates the waiting worker and reloads. Driven by an explicit user click. */
export async function applyNewVersion(): Promise<void> {
  await applyUpdate?.();
}

/**
 * Boot the PWA layer. Safe to call on every platform.
 */
export function initPwa(): void {
  if (Capacitor.isNativePlatform()) {
    // A service worker registered by an earlier web visit to the same origin
    // would outlive an app update and serve a stale bundle from inside the
    // WebView. Actively remove any that exist.
    void navigator.serviceWorker
      ?.getRegistrations?.()
      .then((regs) => regs.forEach((r) => void r.unregister()));
    return;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    // Chrome shows its own mini-infobar unless this is prevented; we want the
    // prompt to appear where it makes sense in the UI instead.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });

  // Imported dynamically: `virtual:pwa-register` only exists when the plugin is
  // enabled, and it is disabled for the mobile build.
  void import("virtual:pwa-register")
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh() {
          onUpdateReady?.();
        },
      });
      applyUpdate = async () => {
        await updateSW(true);
      };
    })
    .catch(() => {
      /* no plugin in this build — nothing to register */
    });
}
