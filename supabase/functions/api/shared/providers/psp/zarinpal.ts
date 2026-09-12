// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import {
  ZARINPAL_MIN_AMOUNT_RIAL,
  type PspProvider,
  type PspRequestInput,
  type PspRequestResult,
  type PspVerifyResult,
} from "./index.ts";

const ZARINPAL_ORIGIN = "https://payment.zarinpal.com";
export const PSP_TIMEOUT_MS = 20_000;

export interface ZarinpalTransportConfig {
  /** Server-side API base. Production edge uses the Cloudflare ZarinPal relay. */
  apiBase?: string;
  /** Shared secret expected by the relay. Never sent to StartPay/browser URLs. */
  proxySecret?: string;
}

type ProviderBody = {
  data?: unknown;
  errors?: unknown;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerCode(body: ProviderBody): number | undefined {
  const dataCode = record(body.data)?.code;
  if (typeof dataCode === "number" && Number.isInteger(dataCode)) return dataCode;
  const errors = Array.isArray(body.errors) ? record(body.errors[0]) : record(body.errors);
  const errorCode = errors?.code;
  return typeof errorCode === "number" && Number.isInteger(errorCode) ? errorCode : undefined;
}

function providerReference(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^\d+$/.test(normalized) && normalized !== "0" ? normalized : undefined;
}

/**
 * ZarinPal returns legitimate business/validation errors as non-2xx JSON
 * (commonly 422). Do not discard that body: it contains `errors.code`, which is
 * the difference between a real provider answer (-51/-55/etc.) and a transport
 * ambiguity. Infrastructure/proxy responses do not have the ZarinPal envelope,
 * so they still normalize to `unknown` safely.
 */
async function post(
  apiBase: string,
  proxySecret: string | undefined,
  path: string,
  payload: unknown,
): Promise<ProviderBody | undefined> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (proxySecret) headers["x-proxy-secret"] = proxySecret;

    const res = await fetch(`${apiBase}/pg/v4/payment/${path}.json`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PSP_TIMEOUT_MS),
    });

    const body = (await res.json()) as unknown;
    return record(body) as ProviderBody | undefined;
  } catch {
    return undefined;
  }
}

/** ZarinPal REST v4 adapter. Only server API calls may be proxied; StartPay
 * always stays on ZarinPal's public origin so the customer's browser never sees
 * or depends on the private relay. */
export function zarinpalPsp(
  merchant: string,
  transport: ZarinpalTransportConfig = {},
): PspProvider {
  const apiBase = (transport.apiBase || ZARINPAL_ORIGIN).replace(/\/$/, "");
  const proxySecret = transport.proxySecret?.trim() || undefined;

  return {
    name: "zarinpal" as const,
    async request(input: PspRequestInput): Promise<PspRequestResult> {
      if (
        !Number.isSafeInteger(input.amountRial) ||
        input.amountRial < ZARINPAL_MIN_AMOUNT_RIAL ||
        !/^https:\/\//i.test(input.callbackUrl)
      ) {
        return { kind: "rejected", code: -9 };
      }

      const body = await post(apiBase, proxySecret, "request", {
        merchant_id: merchant,
        amount: input.amountRial,
        currency: "IRR",
        callback_url: input.callbackUrl,
        description: input.description,
        metadata: input.mobile ? { mobile: input.mobile } : undefined,
      });
      if (!body) return { kind: "unknown" };

      const code = providerCode(body);
      const authority = record(body.data)?.authority;
      if (code === 100) {
        return typeof authority === "string" && authority.length > 0
          ? { kind: "issued", authority, code: 100 }
          : { kind: "unknown", code: 100 };
      }
      return code === undefined ? { kind: "unknown" } : { kind: "rejected", code };
    },

    async verify(authority: string, amountRial: number): Promise<PspVerifyResult> {
      const body = await post(apiBase, proxySecret, "verify", {
        merchant_id: merchant,
        amount: amountRial,
        authority,
      });
      if (!body) return { kind: "unknown" };

      const code = providerCode(body);
      if (code === undefined) return { kind: "unknown" };

      const data = record(body.data);
      const refNumber = providerReference(data?.ref_id);
      const card = data?.card_pan;
      const cardNumber = typeof card === "string" ? card : undefined;

      // A 100/101 without a valid provider reference is malformed. Treat it as
      // ambiguous and let recovery retry; never grant access on code alone.
      if (code === 100 || code === 101) {
        if (!refNumber) return { kind: "unknown", code };
        return code === 100
          ? { kind: "paid", code: 100, refNumber, cardNumber }
          : { kind: "already_verified", code: 101, refNumber, cardNumber };
      }

      // Provider answers that can represent an incomplete/racing payment stay
      // recoverable. -55 is kept retryable like Sheetra's hardened flow because
      // ZarinPal can briefly report transaction-not-found around callback races.
      if (code === -51 || code === -55 || code === -12) return { kind: "pending", code };
      if (code === -52) return { kind: "unknown", code };
      return { kind: "failed", code };
    },

    startUrl(authority: string): string {
      return `${ZARINPAL_ORIGIN}/pg/StartPay/${encodeURIComponent(authority)}`;
    },
  };
}
