// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import {
  PspTransportError,
  ZIBAL_RESULT,
  ZIBAL_STATUS,
  type PspProvider,
  type PspRequestInput,
  type PspRequestResult,
  type PspVerifyResult,
} from "./index.ts";
import { PSP_TIMEOUT_MS } from "./zibal.ts";

const TOKEN_URL = "https://nextpay.org/nx/gateway/token";
const VERIFY_URL = "https://nextpay.org/nx/gateway/verify";
const PAYMENT_URL = "https://nextpay.org/nx/gateway/payment";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSIENT_VERIFY_CODES = new Set([-42, -43, -45, -72]);
const PENDING_VERIFY_CODES = new Set([-1, -3]);

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface NextPayOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

function tomanFromRial(amountRial: number): number | undefined {
  if (!Number.isSafeInteger(amountRial) || amountRial <= 0 || amountRial % 10 !== 0)
    return undefined;
  return amountRial / 10;
}

function numeric(value: unknown): number | undefined {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** NextPay's current nx REST contract. `auto_verify` is intentionally absent:
 * Routino verifies server-to-server and grants only after its own DB checks. */
export function nextpayPsp(apiKey: string, options: NextPayOptions = {}): PspProvider {
  if (!apiKey) throw new Error("NEXTPAY_API_KEY is required when NextPay is active");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PSP_TIMEOUT_MS;

  async function post(url: string, params: URLSearchParams): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof PspTransportError) throw error;
      if (
        error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new PspTransportError("timeout");
      }
      throw new PspTransportError("unavailable");
    }

    if (!response.ok) throw new PspTransportError("unavailable");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {};
    }
    return record(payload) ?? {};
  }

  return {
    name: "nextpay",

    async request(input: PspRequestInput): Promise<PspRequestResult> {
      const amountToman = tomanFromRial(input.amountRial);
      if (amountToman === undefined) {
        return { ok: false, result: 0, failureKind: "invalid_response" };
      }

      const params = new URLSearchParams({
        api_key: apiKey,
        order_id: input.orderId,
        amount: String(amountToman),
        callback_uri: input.callbackUrl,
        currency: "IRT",
      });
      if (input.mobile) params.set("customer_phone", input.mobile);

      const body = await post(TOKEN_URL, params);
      const code = numeric(body.code);
      const transId = typeof body.trans_id === "string" ? body.trans_id : undefined;
      if (code === -1 && transId && UUID_RE.test(transId)) {
        return {
          ok: true,
          ref: transId,
          result: ZIBAL_RESULT.OK,
          providerCode: code,
        };
      }
      if (code === -1 || code === undefined) {
        return {
          ok: false,
          result: code ?? 0,
          providerCode: code,
          failureKind: "invalid_response",
        };
      }
      return {
        ok: false,
        result: code,
        providerCode: code,
        failureKind: "token_rejected",
      };
    },

    async verify(ref: string, amountRial: number): Promise<PspVerifyResult> {
      const amountToman = tomanFromRial(amountRial);
      if (amountToman === undefined || !UUID_RE.test(ref)) {
        return { result: 0, failureKind: "invalid_response" };
      }

      const body = await post(
        VERIFY_URL,
        new URLSearchParams({
          api_key: apiKey,
          trans_id: ref,
          amount: String(amountToman),
          currency: "IRT",
        }),
      );
      const code = numeric(body.code);
      if (code === 0) {
        const returnedToman = numeric(body.amount);
        const orderId = typeof body.order_id === "string" ? body.order_id : undefined;
        if (returnedToman === undefined || !orderId) {
          return {
            result: 0,
            providerCode: code,
            failureKind: "invalid_response",
          };
        }
        const shaparakRef = body.Shaparak_Ref_Id;
        return {
          result: ZIBAL_RESULT.OK,
          status: ZIBAL_STATUS.PAID_VERIFIED,
          providerCode: code,
          amount: returnedToman * 10,
          orderId,
          refNumber:
            typeof shaparakRef === "string" || typeof shaparakRef === "number"
              ? String(shaparakRef)
              : undefined,
          paidAt: typeof body.created_at === "string" ? body.created_at : undefined,
        };
      }

      if (code === undefined) {
        return { result: 0, failureKind: "invalid_response" };
      }
      if (PENDING_VERIFY_CODES.has(code)) {
        return {
          result: code,
          providerCode: code,
          status: ZIBAL_STATUS.PENDING,
          failureKind: "transient_verify",
        };
      }
      return {
        result: code,
        providerCode: code,
        status: code === -4 ? ZIBAL_STATUS.CANCELED_BY_USER : ZIBAL_STATUS.INTERNAL_ERROR,
        failureKind: TRANSIENT_VERIFY_CODES.has(code) ? "transient_verify" : "terminal_verify",
      };
    },

    startUrl(ref: string): string {
      return `${PAYMENT_URL}/${encodeURIComponent(ref)}`;
    },
  };
}
