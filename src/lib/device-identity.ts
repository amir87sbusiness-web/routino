import { Capacitor } from "@capacitor/core";

export const DEVICE_KEY_STORAGE = "routino:device-key:v1";

export interface DeviceDescriptor {
  installationKey: string;
  name: string;
  platform: "web" | "pwa" | "android" | "ios";
  browser?: string;
  os?: string;
}

function randomKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function browserName(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/CriOS\//.test(ua) || /Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

function osName(ua: string): string {
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown OS";
}

function webPlatform(): "web" | "pwa" {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "pwa" : "web";
}

export async function getOrCreateDeviceDescriptor(): Promise<DeviceDescriptor> {
  let installationKey = localStorage.getItem(DEVICE_KEY_STORAGE);
  if (!installationKey) {
    installationKey = randomKey();
    localStorage.setItem(DEVICE_KEY_STORAGE, installationKey);
  }

  const browser = browserName(navigator.userAgent).slice(0, 32);
  const os = osName(navigator.userAgent).slice(0, 32);
  const native = Capacitor.isNativePlatform();
  const nativePlatform = Capacitor.getPlatform();
  const platform = native ? (nativePlatform === "ios" ? "ios" : "android") : webPlatform();

  return {
    installationKey,
    name: `${browser} · ${os}`.slice(0, 64),
    platform,
    browser,
    os,
  };
}
