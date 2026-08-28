import type { PspProvider, PspRequestInput } from "./index.js";
import { ZARINPAL_MIN_AMOUNT_RIAL } from "./index.js";

export interface FakeTxn {
  authority: string;
  amountRial: number;
  callbackUrl: string;
  outcome: "pending" | "paid" | "canceled";
  verifiedOnce: boolean;
}

/** Test/development-only provider with ZarinPal-shaped callbacks. */
export function fakePsp(publicApiUrl: string) {
  const txns = new Map<string, FakeTxn>();
  let sequence = 0;
  let nextRequest: "issued" | "rejected" | "unknown" = "issued";

  const provider: PspProvider & {
    _txns: Map<string, FakeTxn>;
    _settle(authority: string, outcome: "paid" | "canceled"): void;
    _setNextRequest(outcome: "issued" | "rejected" | "unknown"): void;
  } = {
    name: "fake",
    _txns: txns,
    _settle(authority, outcome) {
      const txn = txns.get(authority);
      if (txn) txn.outcome = outcome;
    },
    _setNextRequest(outcome) {
      nextRequest = outcome;
    },
    async request(input: PspRequestInput) {
      const outcome = nextRequest;
      nextRequest = "issued";
      if (outcome === "unknown") return { kind: "unknown" };
      if (outcome === "rejected") return { kind: "rejected", code: -9 };
      if (
        !Number.isSafeInteger(input.amountRial) ||
        input.amountRial < ZARINPAL_MIN_AMOUNT_RIAL ||
        !/^https?:\/\//.test(input.callbackUrl)
      ) {
        return { kind: "rejected", code: -9 };
      }
      sequence += 1;
      const authority = `FAKE-${Date.now()}-${sequence}`;
      txns.set(authority, {
        authority,
        amountRial: input.amountRial,
        callbackUrl: input.callbackUrl,
        outcome: "pending",
        verifiedOnce: false,
      });
      return { kind: "issued", authority, code: 100 };
    },
    async verify(authority, amountRial) {
      const txn = txns.get(authority);
      if (!txn || txn.amountRial !== amountRial) return { kind: "failed", code: -54 };
      if (txn.outcome === "pending") return { kind: "pending", code: -51 };
      if (txn.outcome === "canceled") return { kind: "canceled", code: -51 };
      if (txn.verifiedOnce) {
        return { kind: "already_verified", code: 101, refNumber: `FAKE-${authority}` };
      }
      txn.verifiedOnce = true;
      return {
        kind: "paid",
        code: 100,
        refNumber: `FAKE-${authority}`,
        cardNumber: "621986******1234",
      };
    },
    startUrl(authority) {
      return `${publicApiUrl}/v1/dev/gateway?Authority=${encodeURIComponent(authority)}`;
    },
  };
  return provider;
}
