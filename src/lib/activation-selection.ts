import type { HabitDraft } from "@/components/habits";
import { getActiveVaultId } from "./db/vault";

const KEY_PREFIX = "routino:activation:v1:";

export type ActivationSelection =
  { kind: "existing"; habitId: string } | { kind: "draft"; draft: HabitDraft } | null;

function storageKey(): string {
  return `${KEY_PREFIX}${getActiveVaultId()}`;
}

function validSelection(value: unknown): value is Exclude<ActivationSelection, null> {
  if (!value || typeof value !== "object") return false;
  const selection = value as Partial<Exclude<ActivationSelection, null>>;
  if (selection.kind === "existing") return typeof selection.habitId === "string";
  if (selection.kind !== "draft" || !selection.draft) return false;
  return typeof selection.draft.name === "string" && Array.isArray(selection.draft.weekdays);
}

/** Vault-local prepared starter habit. It survives a retryable trial-start failure. */
export function loadActivationSelection(): ActivationSelection {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveActivationSelection(selection: Exclude<ActivationSelection, null>): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(selection));
  } catch {
    // A retry remains possible in the mounted screen even when storage is unavailable.
  }
}

export function clearActivationSelection(): void {
  try {
    localStorage.removeItem(storageKey());
  } catch {
    // Best effort; a stale selection is still validated before any commit.
  }
}
