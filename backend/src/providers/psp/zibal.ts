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
/**
 * How long we wait on a gateway before giving up.
 *
 * There was no timeout at all here. `fetch` in Deno (which is what the edge
 * deployment runs) has no default one, so a gateway that accepted the connection
 * and then went quiet held the request open until the function itself was
 * killed. That is the exact failure mode of a filtered/VPN-routed connection in
 * Iran, and it is worst precisely when it hurts most: during a burst of
 * simultaneous checkouts, every hung request is a function instance that cannot
 * serve anyone else.
 *
 * A throw is the right outcome, not a special case: `router.ts` already treats
 * any thrown error as "this gateway is unhealthy", parks it, and fails over to
 * the next one. And a timed-out VERIFY is safe by construction — the callback
 * and the status poll both re-verify, so the payment is settled a moment later
 * rather than lost.
 */
export const PSP_TIMEOUT_MS = 12_000;

export interface ZibalRelayOptions {
  url: string;
  secret: string;
  /** Test seams; production uses the platform clock and crypto UUID. */
  now?: () => number;
  nonce?: () => string;
}

const encoder = new TextEncoder();

async function relaySignature(
  secret: string,
  timestamp: string,
  nonce: string,
  path: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}\n${nonce}\n${path}\n${body}`),
  );
  return Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function zibalPsp(merchant: string, relay?: ZibalRelayOptions): PspProvider {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const relayPath = `/v1/${path}`;
    const rawBody = JSON.stringify(body);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (relay) {
      const timestamp = String((relay.now ?? Date.now)());
      const nonce = relay.nonce ? relay.nonce() : crypto.randomUUID();
      headers["x-routino-timestamp"] = timestamp;
      headers["x-routino-nonce"] = nonce;
      headers["x-routino-signature"] = await relaySignature(
        relay.secret,
        timestamp,
        nonce,
        relayPath,
        rawBody,
      );
    }
    const target = relay ? `${relay.url.replace(/\/+$/, "")}${relayPath}` : `${BASE}${relayPath}`;
    const res = await fetch(target, {
      method: "POST",
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(PSP_TIMEOUT_MS),
      redirect: "error",
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
