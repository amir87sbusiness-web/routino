// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type PaymentStage = "checkout_ready" | "callback_received" | "callback_result" | "provider_result";
interface PaymentEvidence {
  paymentId?: unknown;
  authorityHash?: string;
  operation?: "request" | "verify" | "inquiry" | "unVerified";
  outcome?: string;
  platform?: string;
  httpStatus?: number;
  providerCode?: number;
  durationMs?: number;
}

export function paymentAuthorityHash(authority: unknown): string | undefined {
  return typeof authority === "string" && authority.length > 0 && authority.length <= 128
    ? createHash("sha256").update(authority).digest("hex").slice(0, 24)
    : undefined;
}

/** Only selected technical fields leave this boundary. Never log provider bodies. */
export function logPaymentStage(stage: PaymentStage, evidence: PaymentEvidence): void {
  try {
    const safe: Record<string, string | number> = { event: "payment_stage", stage };
    if (typeof evidence.paymentId === "string" && UUID.test(evidence.paymentId)) {
      safe.paymentId = evidence.paymentId;
    }
    if (evidence.authorityHash && /^[a-f0-9]{24}$/.test(evidence.authorityHash)) {
      safe.authorityHash = evidence.authorityHash;
    }
    if (
      evidence.operation &&
      ["request", "verify", "inquiry", "unVerified"].includes(evidence.operation)
    ) {
      safe.operation = evidence.operation;
    }
    if (evidence.platform && ["web", "android", "ios"].includes(evidence.platform))
      safe.platform = evidence.platform;
    if (
      evidence.outcome &&
      [
        "response",
        "http_error",
        "invalid_json",
        "malformed_response",
        "network",
        "timeout",
        "paid",
        "canceled",
        "failed",
        "verify_failed",
        "pending",
        "unknown",
        "PAID",
        "VERIFIED",
        "IN_BANK",
        "FAILED",
        "REVERSED",
        "issued",
        "free",
      ].includes(evidence.outcome)
    )
      safe.outcome = evidence.outcome;
    for (const key of ["httpStatus", "providerCode", "durationMs"] as const) {
      const value = evidence[key];
      if (typeof value === "number" && Number.isFinite(value)) safe[key] = Math.round(value);
    }
    console.info(safe);
  } catch {
    // Diagnostics must never become a dependency of payment completion.
  }
}
