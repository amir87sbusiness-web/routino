import { Capacitor } from "@capacitor/core";
import type { Settings } from "./store";

export type CompletionFeedbackSource = "user" | "remote" | "hydration" | "automatic";

export interface CompletionFeedbackTransition {
  source: CompletionFeedbackSource;
  mutationAccepted: boolean;
  beforeCompleted: boolean;
  afterCompleted: boolean;
}

/** Keeps supplemental feedback tied to an accepted, direct completion only. */
export function shouldTriggerCompletionFeedback({
  source,
  mutationAccepted,
  beforeCompleted,
  afterCompleted,
}: CompletionFeedbackTransition): boolean {
  return source === "user" && mutationAccepted && !beforeCompleted && afterCompleted;
}

let completionAudio: HTMLAudioElement | null = null;
let lastHapticAt = 0;

function getCompletionAudio(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  completionAudio ??= new Audio(`${import.meta.env.BASE_URL}sounds/completion.mp3`);
  return completionAudio;
}

/** Fetch and decode the tiny cue before the first completion interaction. */
export function preloadCompletionCue(): void {
  try {
    const audio = getCompletionAudio();
    if (!audio) return;
    audio.preload = "auto";
    audio.load();
  } catch {
    // Audio is supplemental; unsupported or blocked preload must stay silent.
  }
}

/** Replays the supplied confirmation sound instead of queueing overlapping cues. */
function playCompletionCue(): void {
  try {
    const audio = getCompletionAudio();
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    // Audio is supplemental; unsupported or blocked playback must stay silent.
  }
}

async function playNativeHaptic(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const now = Date.now();
  if (now - lastHapticAt < 90) return;
  lastHapticAt = now;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Native bridges can be unavailable while a WebView is initializing.
  }
}

/** Fire-and-forget supplemental feedback. It never participates in persistence. */
export function triggerCompletionFeedback(
  settings: Pick<Settings, "completionSoundEnabled" | "hapticsEnabled">,
): void {
  if (settings.completionSoundEnabled) playCompletionCue();
  if (settings.hapticsEnabled) void playNativeHaptic();
}
