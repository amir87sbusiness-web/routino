import { toLocalPhone } from "../../lib/phone.js";
import { SmsNotSentError, type SmsProvider } from "./index.js";

/**
 * How long to wait on Kavenegar before giving up on one attempt.
 *
 * There was no timeout at all. Deno's `fetch` (what the edge deployment runs)
 * has no default one, so an API that accepted the connection and then went
 * quiet held the request open until the function itself was killed — the user
 * sees a spinner, then nothing, and no error is ever logged because the code
 * never got to the `catch`. That is the shape of "sometimes the SMS arrives":
 * it is not random, it is whichever attempts happened to get a fast response.
 */
const SMS_TIMEOUT_MS = 8_000;

/** One quick retry. Kavenegar occasionally drops a connection mid-flight, and a
 * second attempt a moment later succeeds — cheaper than making the user request
 * a new code and burn a rate-limit slot. Deliberately ONE retry, not a loop:
 * every attempt is a real message if it lands, and a retry storm against an API
 * that is actually down is how you get rate-limited by the provider. */
const RETRIES = 1;
const RETRY_DELAY_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kavenegar wraps every reply — success or failure — in this envelope. */
interface KavenegarResponse {
  return?: { status?: number; message?: string };
}

/**
 * Kavenegar `verify/lookup`.
 *
 * This is the OTP-specific path, not the general send API — it is the one that
 * reliably reaches Iranian handsets, so it is the correct choice even though it
 * requires a pre-approved template.
 *
 * Template constraints that bite: it must be approved in Kavenegar's panel
 * (human review, days of lead time — start it early), and the token may not
 * contain spaces and must be short. A 4-digit code fits.
 */
export function kavenegarSms(apiKey: string, template: string): SmsProvider {
  return {
    async sendOtp(phone, code) {
      const url = new URL(`https://api.kavenegar.com/v1/${apiKey}/verify/lookup.json`);
      // `09…`, not the canonical `98…` we store. Kavenegar's `receptor` is
      // documented in the local Iranian format, and the payment path already
      // converts for exactly this reason (`toLocalPhone` in payment-flow before
      // handing the number to the payment gateway) — the SMS path had simply been missed.
      // Nothing catches this until the day console mode is switched off, and
      // then it fails for every new sign-up with only a log line to show for it.
      url.searchParams.set("receptor", toLocalPhone(phone));
      url.searchParams.set("token", code);
      url.searchParams.set("template", template);

      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAY_MS);
        try {
          const res = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
          });

          // Read the body ONCE, as text, before deciding anything. Kavenegar
          // returns its real reason (wrong template name, unapproved template,
          // no credit, blocked receptor) in the JSON body even on a non-200,
          // and the old code threw on `!res.ok` without reading it — so the one
          // piece of information that explains the failure was discarded every
          // single time.
          const raw = await res.text();
          let parsed: KavenegarResponse | null = null;
          try {
            parsed = JSON.parse(raw) as KavenegarResponse;
          } catch {
            /* not JSON — `raw` is included in the error below */
          }

          const status = parsed?.return?.status;
          const message = parsed?.return?.message;

          if (res.ok && status === 200) return; // sent

          // Never include the code or the API key. The URL holds both, so the
          // message is built from the response only.
          const detail = message ?? raw.slice(0, 200) ?? "no body";
          const text = `kavenegar HTTP ${res.status} status=${status ?? "?"}: ${detail}`;

          // A 4xx from Kavenegar is a configuration problem — an unapproved
          // template, a bad API key, an out-of-credit account. Retrying cannot
          // fix it, and nothing was sent, so it is `SmsNotSentError`: the caller
          // refunds the user's rate-limit slot instead of charging them for our
          // misconfiguration.
          if (res.status >= 400 && res.status < 500) throw new SmsNotSentError(text);
          lastError = new Error(text);
        } catch (err) {
          // AbortSignal.timeout rejects with a TimeoutError; a dropped
          // connection rejects with a TypeError. Both are worth one retry.
          lastError = err instanceof Error ? err : new Error(String(err));
          // A definite non-send must not be retried or swallowed.
          if (err instanceof SmsNotSentError) throw err;
        }
      }

      throw lastError ?? new Error("kavenegar: send failed for an unknown reason");
    },
  };
}
