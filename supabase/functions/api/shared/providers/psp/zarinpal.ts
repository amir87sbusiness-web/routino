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
  apiBase?: string;
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

async function postOnce(
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
    if (!res.ok) return undefined;
    const body = (await res.json()) as unknown;
    return record(body) as ProviderBody | undefined;
  } catch {
    return undefined;
  }
}

async function post(
  apiBase: string,
  proxySecret: string | undefined,
  path: string,
  payload: unknown,
): Promise<ProviderBody | undefined> {
  const primary = await postOnce(apiBase, proxySecret, path, payload);
  if (primary || apiBase === ZARINPAL_ORIGIN) return primary;
  return postOnce(ZARINPAL_ORIGIN, undefined, path, payload);
}

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
          : { kind: "unknown" };
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
      const ref = data?.ref_id;
      const card = data?.card_pan;
      const successDetails = {
        refNumber: typeof ref === "number" || typeof ref === "string" ? String(ref) : undefined,
        cardNumber: typeof card === "string" ? card : undefined,
      };
      if (code === 100) return { kind: "paid", code: 100, ...successDetails };
      if (code === 101) return { kind: "already_verified", code: 101, ...successDetails };

      if (code === -51 || code === -12) return { kind: "pending", code };
      if (code === -52) return { kind: "unknown", code };
      return { kind: "failed", code };
    },

    startUrl(authority: string): string {
      return `${ZARINPAL_ORIGIN}/pg/StartPay/${encodeURIComponent(authority)}`;
    },
  };
}
