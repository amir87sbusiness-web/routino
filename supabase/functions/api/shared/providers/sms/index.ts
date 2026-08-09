// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * SMS abstraction.
 *
 * Kavenegar's OTP template needs human approval in their panel, which takes
 * days. Building behind this interface means none of the auth work is blocked on
 * that, and the console adapter makes the whole OTP flow testable offline.
 */
export interface SmsProvider {
  /** Sends the OTP. Throws on a provider error so the route can 502. */
  sendOtp(phone: string, code: string): Promise<void>;
}

/**
 * Thrown when the provider is CERTAIN no message left its system — an
 * unapproved template, a bad API key, an empty account, a rejected receptor.
 *
 * The distinction is about money, and therefore about the rate limit. A send
 * that never happened cost nothing, so holding the user's slot for it punishes
 * them for our misconfiguration: they never got a code, and the per-hour limit
 * still locks them out. An AMBIGUOUS failure (timeout, 5xx, dropped socket) is
 * deliberately NOT this error — the message may well have gone out, so the slot
 * stays spent and the SMS bill stays protected.
 */
export class SmsNotSentError extends Error {
  readonly notSent = true;
  constructor(message: string) {
    super(message);
    this.name = "SmsNotSentError";
  }
}

export { consoleSms } from "./console.ts";
export { kavenegarSms } from "./kavenegar.ts";
