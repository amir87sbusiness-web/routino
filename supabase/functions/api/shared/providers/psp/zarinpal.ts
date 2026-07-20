// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import type { PspProvider, PspRequestInput, PspRequestResult, PspVerifyResult } from "./index.ts";
import { ZIBAL_RESULT, ZIBAL_STATUS } from "./index.ts";

const BASE = "https://payment.zarinpal.com/pg";

/**
 * ZarinPal gateway (REST API v4).
 *
 * Speaks ZarinPal's dialect on the wire and TRANSLATES to the canonical
 * `ZIBAL_RESULT`/`ZIBAL_STATUS` codes on the way out, so `routes/payments.ts`
 * treats a ZarinPal payment exactly like a Zibal one. The two shapes that differ
 * from Zibal and are handled here:
 *
 *  - Transaction id is a 36-char string `authority` (our generic `ref`), not a
 *    number. `startUrl` and `verify` take it verbatim.
 *  - `amount` is sent in RIAL. We pin `currency: "IRR"` explicitly so the unit
 *    can never depend on the merchant's dashboard default. ZarinPal's *verify*
 *    does NOT return the paid amount — you re-send the amount and the gateway
 *    refuses (non-100) if it does not match what was actually paid. So the
 *    amount check is enforced gateway-side; the adapter echoes the charged
 *    amount back on success to keep the caller's `amount === charged` assertion
 *    truthful for both gateways.
 *
 * NOTE: confirm the Rial unit with the very first real transaction (your own
 * card), per the launch checklist — a unit mistake here is a 10× overcharge.
 *
 * ZarinPal verify codes: 100 = verified now, 101 = already verified (idempotent
 * replay). Anything else is a non-success we do not grant on.
 */
export function zarinpalPsp(merchant: string): PspProvider {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE}/v4/payment/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`zarinpal ${path} HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    name: "zarinpal",

    async request(input: PspRequestInput): Promise<PspRequestResult> {
      const body = await post<{
        data?: { code?: number; authority?: string; message?: string };
        errors?: { code?: number; message?: string } | unknown[];
      }>("request.json", {
        merchant_id: merchant,
        amount: input.amountRial,
        currency: "IRR",
        callback_url: input.callbackUrl,
        description: input.description ?? "Routino",
        metadata: input.mobile ? { mobile: input.mobile } : undefined,
      });

      const code = body.data?.code;
      const authority = body.data?.authority;
      if (code === 100 && authority) {
        return { ok: true, ref: authority, result: ZIBAL_RESULT.OK };
      }
      const errCode = !Array.isArray(body.errors) ? body.errors?.code : undefined;
      return {
        ok: false,
        // Surface ZarinPal's own numeric code for the logs; it is negative, so it
        // never collides with a canonical Zibal result.
        result: code ?? errCode ?? 0,
        message: body.data?.message ?? (!Array.isArray(body.errors) ? body.errors?.message : undefined),
      };
    },

    async verify(ref: string, amountRial: number): Promise<PspVerifyResult> {
      const body = await post<{
        data?: { code?: number; ref_id?: number | string; card_pan?: string; message?: string };
        errors?: { code?: number; message?: string } | unknown[];
      }>("verify.json", {
        merchant_id: merchant,
        amount: amountRial,
        authority: ref,
      });

      const code = body.data?.code;
      if (code === 100) {
        return {
          result: ZIBAL_RESULT.OK,
          status: ZIBAL_STATUS.PAID_VERIFIED,
          // ZarinPal gives no amount back; echo what we asked for. The gateway
          // already refused to reach code 100 on a mismatch, so this is safe.
          amount: amountRial,
          refNumber: body.data?.ref_id != null ? String(body.data.ref_id) : undefined,
          cardNumber: body.data?.card_pan,
        };
      }
      if (code === 101) {
        // Already verified in an earlier callback: same meaning as Zibal's 201.
        // The amount was asserted the first time; the applied_at guard makes the
        // re-apply safe.
        return { result: ZIBAL_RESULT.ALREADY_VERIFIED };
      }
      const errCode = !Array.isArray(body.errors) ? body.errors?.code : undefined;
      // Not verified: user did not complete, amount mismatch (-51/-55), etc.
      // Report as an internal-error status so the caller marks it failed rather
      // than granting.
      return {
        result: code ?? errCode ?? 0,
        status: ZIBAL_STATUS.INTERNAL_ERROR,
        message: body.data?.message ?? (!Array.isArray(body.errors) ? body.errors?.message : undefined),
      };
    },

    startUrl(ref: string) {
      return `${BASE}/StartPay/${ref}`;
    },
  };
}
