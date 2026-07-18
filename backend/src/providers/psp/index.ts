/**
 * Payment gateway abstraction.
 *
 * Two adapters: `fake` (a local page with Pay/Cancel buttons) and `zibal`.
 * Building the fake first is the highest-leverage decision in the payment work —
 * the entire state machine, idempotency, amount validation and deep-link return
 * become testable with no external dependency, no rate limits and no flakiness.
 * Payment is where bugs cost real money; its test loop must not depend on a
 * third party's sandbox uptime.
 */

/** Zibal result codes (`result` field on request/verify responses). */
export const ZIBAL_RESULT = {
  OK: 100,
  MERCHANT_NOT_FOUND: 102,
  MERCHANT_INACTIVE: 103,
  MERCHANT_INVALID: 104,
  AMOUNT_TOO_LOW: 105, // amount must be > 1000 Rial
  CALLBACK_INVALID: 106, // rejects non-http(s) URLs — why a custom scheme can't be the callback
  AMOUNT_TOO_HIGH: 113,
  ALREADY_VERIFIED: 201,
} as const;

/** Zibal transaction `status` on verify. */
export const ZIBAL_STATUS = {
  PAID_VERIFIED: 1,
  PAID_UNVERIFIED: 2,
  CANCELED_BY_USER: 3,
  INVALID_CARD_NUMBER: 4,
  PENDING: -1,
  INTERNAL_ERROR: -2,
} as const;

export interface PspRequestInput {
  /** RIAL. Zibal bills in Rial; the app prices in Toman. */
  amountRial: number;
  callbackUrl: string;
  /** Our `payments.id`, echoed back on the callback. */
  orderId: string;
  description?: string;
  /** Pre-fills the card-holder's mobile — measurably lifts conversion on
   * Iranian gateways, and costs nothing. */
  mobile?: string;
}

export interface PspRequestResult {
  ok: boolean;
  trackId?: number;
  result: number;
  message?: string;
}

export interface PspVerifyResult {
  result: number;
  /** RIAL, as the gateway saw it. Must be asserted against what we charged. */
  amount?: number;
  status?: number;
  refNumber?: string;
  cardNumber?: string;
  paidAt?: string;
  message?: string;
}

export interface PspProvider {
  readonly name: "fake" | "zibal";
  request(input: PspRequestInput): Promise<PspRequestResult>;
  verify(trackId: number): Promise<PspVerifyResult>;
  /** The URL to send the user's browser to. */
  startUrl(trackId: number): string;
}

export { zibalPsp } from "./zibal.js";
export { fakePsp } from "./fake.js";
