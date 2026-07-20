import type { PspProvider, PspRequestInput, PspRequestResult, PspVerifyResult } from "./index.js";

const BASE = "https://gateway.zibal.ir";

/**
 * Zibal gateway.
 *
 * Sandbox is enabled by using the literal merchant id `"zibal"` — there is no
 * separate sandbox host.
 *
 * `amount` is in RIAL.
 */
export function zibalPsp(merchant: string): PspProvider {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE}/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`zibal ${path} HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    name: "zibal",

    async request(input: PspRequestInput): Promise<PspRequestResult> {
      const body = await post<{ result: number; trackId?: number; message?: string }>("request", {
        merchant,
        amount: input.amountRial,
        callbackUrl: input.callbackUrl,
        orderId: input.orderId,
        description: input.description,
        mobile: input.mobile,
      });
      return {
        ok: body.result === 100,
        ref: body.trackId != null ? String(body.trackId) : undefined,
        result: body.result,
        message: body.message,
      };
    },

    // amountRial is unused: Zibal's verify echoes the amount back and the caller
    // asserts it. It is in the signature only so every provider verifies alike.
    async verify(ref: string): Promise<PspVerifyResult> {
      const trackId = Number(ref);
      const body = await post<{
        result: number;
        amount?: number;
        status?: number;
        refNumber?: number | string;
        cardNumber?: string;
        paidAt?: string;
        message?: string;
      }>("verify", { merchant, trackId });
      return {
        result: body.result,
        amount: body.amount,
        status: body.status,
        refNumber: body.refNumber != null ? String(body.refNumber) : undefined,
        cardNumber: body.cardNumber,
        paidAt: body.paidAt,
        message: body.message,
      };
    },

    startUrl(ref: string) {
      return `${BASE}/start/${Number(ref)}`;
    },
  };
}
