// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import type { SmsProvider } from "./index.ts";

/**
 * Kavenegar `verify/lookup`.
 *
 * This is the OTP-specific path, not the general send API — it is the one that
 * reliably reaches Iranian handsets, so it is the correct choice even though it
 * requires a pre-approved template.
 *
 * Template constraints that bite: it must be approved in Kavenegar's panel
 * (human review, days of lead time — start it early), and the token may not
 * contain spaces and must be short. A 6-digit code fits.
 */
export function kavenegarSms(apiKey: string, template: string): SmsProvider {
  return {
    async sendOtp(phone, code) {
      const url = new URL(`https://api.kavenegar.com/v1/${apiKey}/verify/lookup.json`);
      url.searchParams.set("receptor", phone);
      url.searchParams.set("token", code);
      url.searchParams.set("template", template);

      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        // Never include the code or the API key in the error.
        throw new Error(`kavenegar HTTP ${res.status}`);
      }
      const body = (await res.json()) as { return?: { status?: number; message?: string } };
      const status = body.return?.status;
      if (status !== 200) {
        throw new Error(`kavenegar status ${status}: ${body.return?.message ?? "unknown"}`);
      }
    },
  };
}
