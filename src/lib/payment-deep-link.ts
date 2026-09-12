export interface PaymentDeepLink {
  paymentId: string;
  status?: string;
}

/**
 * Parse only Routino's own payment-return custom scheme.
 *
 * Keeping this strict prevents an unrelated app URL from being interpreted as
 * a payment result. The server remains authoritative for the actual payment
 * state; `status` is only a UI hint used by /pay/result.
 */
export function parsePaymentDeepLink(url: string): PaymentDeepLink | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "routino:" || parsed.hostname !== "pay" || parsed.pathname !== "/result") {
      return null;
    }

    const paymentId = parsed.searchParams.get("paymentId")?.trim();
    if (!paymentId) return null;

    const status = parsed.searchParams.get("status")?.trim();
    return status ? { paymentId, status } : { paymentId };
  } catch {
    return null;
  }
}
