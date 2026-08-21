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

let audioContext: AudioContext | null = null;
let activeOscillator: OscillatorNode | null = null;
let lastHapticAt = 0;

/** A short, original rising confirmation tone. Replaces the active cue instead
 * of queueing more sound when several habits are completed in quick succession. */
function playCompletionCue(): void {
  try {
    if (typeof window === "undefined" || !window.AudioContext) return;
    const context = audioContext ?? new window.AudioContext();
    audioContext = context;

    activeOscillator?.stop();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(560, now);
    oscillator.frequency.exponentialRampToValueAtTime(720, now + 0.075);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.095);
    activeOscillator = oscillator;
    oscillator.addEventListener("ended", () => {
      if (activeOscillator === oscillator) activeOscillator = null;
      oscillator.disconnect();
      gain.disconnect();
    });
    void context.resume().catch(() => undefined);
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
