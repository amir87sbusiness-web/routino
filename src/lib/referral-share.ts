import { Capacitor } from "@capacitor/core";

export const ROUTINO_APP_URL = "https://routino.me";

export type ReferralShareResult = "shared" | "copied" | "canceled";

export async function shareReferralCode(
  code: string,
  message: string,
): Promise<ReferralShareResult> {
  const text = `${message}\n${code}\n${ROUTINO_APP_URL}`;
  try {
    if (Capacitor.isNativePlatform()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: "Routino", text, url: ROUTINO_APP_URL, dialogTitle: "Routino" });
      return "shared";
    }
    if (typeof navigator.share === "function") {
      await navigator.share({ title: "Routino", text, url: ROUTINO_APP_URL });
      return "shared";
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "canceled";
    // A missing native/web share target falls through to the local clipboard.
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}
