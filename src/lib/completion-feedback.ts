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

/** Replays the supplied confirmation sound instead of queueing overlapping cues. */
function playCompletionCue(): void {
  try {
    if (typeof Audio === "undefined") return;
    const audio = completionAudio ?? new Audio(`${import.meta.env.BASE_URL}sounds/completion.mp3`);
    completionAudio = audio;
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
