// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import type { SmsProvider } from "./index.ts";

/** Dev adapter: prints the code instead of sending it. Never selectable in
 * production — `env.ts` guards that. */
export function consoleSms(): SmsProvider {
  return {
    async sendOtp(phone, code) {
      // The one place a code may appear in plaintext, and only when explicitly
      // configured for local development.
      console.log(`\n  [sms:console] OTP for ${phone} -> ${code}\n`);
    },
  };
}
