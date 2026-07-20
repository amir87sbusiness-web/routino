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

export { consoleSms } from "./console.ts";
export { kavenegarSms } from "./kavenegar.ts";
