import type { PspProvider, PspRequestInput, PspVerifyResult } from "./index.js";
import { ZIBAL_RESULT, ZIBAL_STATUS } from "./index.js";

interface FakeTxn {
  trackId: number;
  amountRial: number;
  orderId: string;
  callbackUrl: string;
  /** Set by the dev gateway page when the user clicks Pay or Cancel. */
  outcome: "pending" | "paid" | "canceled";
  verifiedOnce: boolean;
}

/**
 * In-memory gateway that mimics Zibal's contract exactly — same result codes,
 * same status codes, same `201 already verified` on a second verify.
 *
 * Lets the payment state machine, idempotency and the deep-link return be
 * developed and tested with no network. Deliberately mirrors Zibal's quirks
 * rather than being "nice", so code written against it works unchanged against
 * the real gateway.
 */
export function fakePsp(publicApiUrl: string) {
  const txns = new Map<number, FakeTxn>();
  // Seed from wall-clock time so a server restart never reuses a trackId that
  // is already persisted in the dev database (the in-memory counter resets, but
  // PGlite on disk does not). Real Zibal issues globally-unique trackIds, so
  // this collision is a fake-gateway-only concern. Tests get a fresh DB, so the
  // exact value never matters there.
  let nextTrackId = Date.now();

  const provider: PspProvider & {
    _txns: Map<number, FakeTxn>;
    _settle(trackId: number, outcome: "paid" | "canceled"): void;
  } = {
    name: "fake",
    _txns: txns,

    /** Called by the dev gateway route when the user picks an outcome. */
    _settle(trackId, outcome) {
      const t = txns.get(trackId);
      if (t) t.outcome = outcome;
    },

    async request(input: PspRequestInput) {
      // Mirror Zibal's real validation so we hit these branches in tests.
      if (input.amountRial <= 1000) return { ok: false, result: ZIBAL_RESULT.AMOUNT_TOO_LOW };
      if (!/^https?:\/\//.test(input.callbackUrl)) return { ok: false, result: ZIBAL_RESULT.CALLBACK_INVALID };

      const trackId = nextTrackId++;
      txns.set(trackId, {
        trackId,
        amountRial: input.amountRial,
        orderId: input.orderId,
        callbackUrl: input.callbackUrl,
        outcome: "pending",
        verifiedOnce: false,
      });
      return { ok: true, trackId, result: ZIBAL_RESULT.OK };
    },

    async verify(trackId: number): Promise<PspVerifyResult> {
      const t = txns.get(trackId);
      if (!t) return { result: 203, message: "invalid trackId" };
      if (t.outcome === "canceled") return { result: 202, status: ZIBAL_STATUS.CANCELED_BY_USER };
      if (t.outcome === "pending") return { result: 202, status: ZIBAL_STATUS.PENDING };

      if (t.verifiedOnce) {
        // Zibal returns 201 WITHOUT the amount — which is exactly why an
        // inquiry endpoint is the only safe way out of an unexpected 201.
        return { result: ZIBAL_RESULT.ALREADY_VERIFIED };
      }
      t.verifiedOnce = true;
      return {
        result: ZIBAL_RESULT.OK,
        amount: t.amountRial,
        status: ZIBAL_STATUS.PAID_VERIFIED,
        refNumber: `FAKE-${trackId}`,
        cardNumber: "621986******1234",
        paidAt: new Date().toISOString(),
      };
    },

    startUrl(trackId: number) {
      return `${publicApiUrl}/v1/dev/gateway?trackId=${trackId}`;
    },
  };

  return provider;
}
