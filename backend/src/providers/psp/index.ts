/**
 * Payment gateway abstraction.
 *
 * Adapters: `fake` (a local page with Pay/Cancel buttons), `zibal`, `zarinpal`.
 * Building the fake first is the highest-leverage decision in the payment work —
 * the entire state machine, idempotency, amount validation and deep-link return
 * become testable with no external dependency, no rate limits and no flakiness.
 * Payment is where bugs cost real money; its test loop must not depend on a
 * third party's sandbox uptime.
 *
 * ## The canonical result contract
 *
 * `ZIBAL_RESULT`/`ZIBAL_STATUS` are the *canonical* codes the payment route
 * reasons in. Zibal happens to speak them natively; every other adapter
 * TRANSLATES its own gateway's codes into these. That is the whole trick that
 * lets `routes/payments.ts` stay gateway-agnostic — the money logic (amount
 * assertion, apply-once idempotency) never learns a second dialect.
 *
 * ## The generic `ref` token
 *
 * Zibal identifies a transaction with a numeric `trackId`; ZarinPal with a
 * 36-char string `authority`. So the boundary token is a plain `string` (`ref`):
 * numeric providers pass their trackId as its decimal string, ZarinPal passes
 * the authority verbatim. Which provider a payment belongs to is recorded on the
 * `payments` row, so verify/startUrl always route back to the right one.
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
  IP_NOT_ALLOWED: 115,
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

/** The set of concrete gateway adapters. */
export type PspName = "fake" | "zibal" | "zarinpal";

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
  /** Opaque gateway token: numeric providers pass `String(trackId)`, ZarinPal
   * passes its `authority`. Present only when `ok`. */
  ref?: string;
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
  readonly name: PspName;
  request(input: PspRequestInput): Promise<PspRequestResult>;
  /**
   * `amountRial` is what we charged. Zibal ignores it (its verify echoes the
   * amount back for us to assert). ZarinPal's verify has no amount in the
   * response — you SEND the amount and the gateway itself refuses to verify a
   * mismatch — so its adapter passes this through and echoes it back, keeping
   * the caller's `amount === charged` assertion honest for both.
   */
  verify(ref: string, amountRial: number): Promise<PspVerifyResult>;
  /** The URL to send the user's browser to. */
  startUrl(ref: string): string;
}

/** What the router hands back from a checkout: the same shape as a single
 * provider's result, plus WHICH provider actually took it (persisted on the
 * payment so verify/callback route back to the same gateway). */
export interface PspCheckout extends PspRequestResult {
  provider: PspName;
}

/**
 * Fronts one or more providers. With a single provider it is a thin pass-through
 * (so "only one gateway configured" is always enough). With several it picks the
 * fastest healthy one per checkout and fails over automatically. verify/startUrl
 * take an explicit provider name — the caller reads it off the payment row, so a
 * transaction is always finished on the gateway that started it.
 */
export interface PspRouter {
  readonly providers: PspName[];
  get(name: PspName): PspProvider | undefined;
  request(input: PspRequestInput): Promise<PspCheckout>;
  verify(provider: PspName, ref: string, amountRial: number): Promise<PspVerifyResult>;
  startUrl(provider: PspName, ref: string): string;
}

export { zibalPsp } from "./zibal.js";
export { fakePsp } from "./fake.js";
export { zarinpalPsp } from "./zarinpal.js";
export { createRouter } from "./router.js";
