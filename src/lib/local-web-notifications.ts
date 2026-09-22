export interface LocalWebNotificationPayload {
  /** Stable occurrence id. Reusing it must never show the same event twice. */
  id: string;
  title: string;
  body: string;
}

export type LocalWebNotificationResult =
  | "shown"
  | "duplicate"
  | "permission-required"
  | "unsupported"
  | "failed";

const DELIVERED_KEY = "routino:web-notifications:delivered:v1";
const MAX_DELIVERED_IDS = 300;
const deliveredInMemory = new Set<string>();
const inFlight = new Set<string>();

function deliveredIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(DELIVERED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function wasDelivered(id: string): boolean {
  return deliveredInMemory.has(id) || deliveredIds().includes(id);
}

function rememberDelivered(id: string): void {
  deliveredInMemory.add(id);
  try {
    const ids = deliveredIds().filter((item) => item !== id);
    localStorage.setItem(DELIVERED_KEY, JSON.stringify([...ids, id].slice(-MAX_DELIVERED_IDS)));
  } catch {
    // Private browsing may reject storage; the in-memory guard still prevents
    // duplicates for the lifetime of this page.
  }
}

/**
 * Best-effort local web notification. This never asks for permission, never
 * talks to Routino's backend, and only consumes an id after actual delivery.
 */
export async function showLocalWebNotification(
  payload: LocalWebNotificationPayload,
): Promise<LocalWebNotificationResult> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "granted") return "permission-required";
  if (wasDelivered(payload.id) || inFlight.has(payload.id)) return "duplicate";

  inFlight.add(payload.id);
  const options: NotificationOptions = { body: payload.body, tag: payload.id };
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if ("serviceWorker" in navigator) {
          try {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
              await registration.showNotification(payload.title, options);
              rememberDelivered(payload.id);
              return "shown";
            }
          } catch {
            // Try the page-level API below, then retry once in case the worker
            // was only between lifecycle states.
          }
        }

        new Notification(payload.title, options);
        rememberDelivered(payload.id);
        return "shown";
      } catch {
        // One bounded retry covers transient OS/SW delivery failures without
        // spinning, prompting, or adding another in-app history item.
      }
    }
    return "failed";
  } finally {
    inFlight.delete(payload.id);
  }
}
