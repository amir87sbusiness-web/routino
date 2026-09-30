export interface GuideState {
  version: 1;
  pending: boolean;
  enabled: boolean;
  progress: Record<string, { step: string; done: boolean }>;
}

export const GUIDE_CHANGED = "routino:guide-changed";
export const GUIDE_HELP = "routino:guide-help";
const sessionFallback = new Map<string, GuideState>();
const key = (owner: string) => `routino:guide:v1:${owner}`;
const empty = (): GuideState => ({ version: 1, pending: false, enabled: false, progress: {} });

export function readGuide(owner: string): GuideState {
  const fallback = sessionFallback.get(owner);
  if (fallback) return fallback;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(owner)) ?? "null");
    if (!raw || typeof raw !== "object") return empty();
    const value = raw as Partial<GuideState>;
    if (
      value.version !== 1 ||
      typeof value.enabled !== "boolean" ||
      typeof value.pending !== "boolean"
    )
      return empty();
    const progress: GuideState["progress"] = {};
    if (value.progress && typeof value.progress === "object") {
      for (const [id, entry] of Object.entries(value.progress)) {
        if (entry && typeof entry.step === "string" && typeof entry.done === "boolean")
          progress[id] = { step: entry.step, done: entry.done };
      }
    }
    return { version: 1, pending: value.pending, enabled: value.enabled, progress };
  } catch {
    return sessionFallback.get(owner) ?? empty();
  }
}

function write(owner: string, state: GuideState) {
  try {
    localStorage.setItem(key(owner), JSON.stringify(state));
    sessionFallback.delete(owner);
  } catch {
    sessionFallback.set(owner, state);
  }
  window.dispatchEvent(new CustomEvent(GUIDE_CHANGED, { detail: { owner } }));
}

/** Only the authoritative isNew registration path calls this. */
export function prepareGuide(owner: string) {
  const state = readGuide(owner);
  if (!state.enabled && !state.pending) write(owner, { ...state, pending: true });
}

/** Called after successful personalization, never just because a key is missing. */
export function activateGuide(owner: string) {
  const state = readGuide(owner);
  if (state.pending) write(owner, { ...state, pending: false, enabled: true });
}

export function replayGuide(owner: string) {
  write(owner, { ...empty(), enabled: true });
}

export function saveGuideProgress(owner: string, section: string, step: string, done: boolean) {
  const state = readGuide(owner);
  write(owner, { ...state, progress: { ...state.progress, [section]: { step, done } } });
}
