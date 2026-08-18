export const OFFLINE_LEASE_MS = 15 * 86_400_000;

export type SessionRevocationReason =
  "device_replaced" | "device_revoked" | "device_security_locked";

export interface SessionDecisionInput {
  now: number;
  lastServerConfirmedAt: number;
  online: boolean;
  serverConfirmed?: boolean;
  revokedReason?: SessionRevocationReason;
}

export type SessionDecision =
  | { kind: "valid" }
  | { kind: "offline-valid"; remainingMs: number }
  | { kind: "needs-online-confirmation" }
  | { kind: "revoked"; reason: SessionRevocationReason };

export function decideSession(input: SessionDecisionInput): SessionDecision {
  if (input.revokedReason) return { kind: "revoked", reason: input.revokedReason };
  if (input.serverConfirmed) return { kind: "valid" };

  const remainingMs = input.lastServerConfirmedAt + OFFLINE_LEASE_MS - input.now;
  if (remainingMs <= 0) return { kind: "needs-online-confirmation" };
  return input.online ? { kind: "valid" } : { kind: "offline-valid", remainingMs };
}

export function isSessionRevocationReason(value: string): value is SessionRevocationReason {
  return (
    value === "device_replaced" || value === "device_revoked" || value === "device_security_locked"
  );
}
