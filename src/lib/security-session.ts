export const OFFLINE_LEASE_MS = 15 * 86_400_000;

export interface SessionDecisionInput {
  now: number;
  lastServerConfirmedAt: number;
  online: boolean;
  serverConfirmed?: boolean;
}

export type SessionDecision =
  | { kind: "valid" }
  | { kind: "offline-valid"; remainingMs: number }
  | { kind: "needs-online-confirmation" };

export function decideSession(input: SessionDecisionInput): SessionDecision {
  if (input.serverConfirmed) return { kind: "valid" };

  const remainingMs = input.lastServerConfirmedAt + OFFLINE_LEASE_MS - input.now;
  if (remainingMs <= 0) return { kind: "needs-online-confirmation" };
  return input.online ? { kind: "valid" } : { kind: "offline-valid", remainingMs };
}
