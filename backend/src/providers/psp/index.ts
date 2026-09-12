/** Gateway-neutral payment-provider boundary.
 *
 * Production constructs exactly one ZarinPal adapter. The fake adapter exists
 * only so the same payment state machine can be exercised without money or an
 * external network. Provider-native response bodies never cross this boundary.
 */

/** Current minimum documented by ZarinPal for IRR payment requests. */
export const ZARINPAL_MIN_AMOUNT_RIAL = 10_000;

export interface PspRequestInput {
  /** Server-computed amount in Rial. */
  amountRial: number;
  /** HTTPS backend callback; never a client deep link. */
  callbackUrl: string;
  description: string;
  mobile?: string;
}

export type PspRequestResult =
  | { kind: "issued"; authority: string; code: 100 }
  | { kind: "rejected"; code: number }
  | { kind: "unknown"; code?: number };

export type PspVerifyResult =
  | {
      kind: "paid" | "already_verified";
      code: 100 | 101;
      refNumber?: string;
      cardNumber?: string;
    }
  | { kind: "pending" | "canceled" | "failed" | "unknown"; code?: number };

export interface PspProvider {
  readonly name: "fake" | "zarinpal";
  request(input: PspRequestInput): Promise<PspRequestResult>;
  /** Verify uses only the authority and amount persisted by Routino. */
  verify(authority: string, amountRial: number): Promise<PspVerifyResult>;
  startUrl(authority: string): string;
}

export { fakePsp } from "./fake.js";
export { zarinpalPsp } from "./zarinpal.js";
