/**
 * HTTP transport for the Routino API.
 *
 * Two things this deliberately does NOT do:
 *  - throw on offline in a way callers must handle specially. Network failure is
 *    a normal state for this app, so it surfaces as a typed `ApiError` with
 *    `offline: true` and every caller treats it as "try again later".
 *  - hold any UI. Nothing here is ever awaited on a render path.
 */
import { Capacitor } from "@capacitor/core";

/** Same-origin `/v1` in dev (Vite proxies it); absolute in native builds, where
 * the app is served from `https://localhost` and has no server of its own. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** True when the request never reached the server. */
    readonly offline = false,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const isOffline = (err: unknown): boolean => err instanceof ApiError && err.offline;

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * On native, use Capacitor's HTTP bridge rather than `fetch`.
 *
 * The WebView's origin is `https://localhost`, so every `fetch` to the API is
 * cross-origin and pays a CORS preflight — on every sync push. CapacitorHttp
 * goes through the native stack, where CORS does not apply at all.
 *
 * The plugin is imported dynamically, after the platform check, so it stays out
 * of the web bundle entirely — the same pattern `lib/native-notifications.ts`
 * already uses.
 */
async function nativeRequest(url: string, opts: RequestOptions, headers: Record<string, string>): Promise<RawResponse> {
  const { CapacitorHttp } = await import("@capacitor/core");
  const res = await CapacitorHttp.request({
    url,
    method: opts.method ?? "GET",
    headers,
    data: opts.body,
    connectTimeout: opts.timeoutMs ?? 15_000,
    readTimeout: opts.timeoutMs ?? 15_000,
  });
  return { status: res.status, body: res.data, headers: (res.headers ?? {}) as Record<string, string> };
}

async function webRequest(url: string, opts: RequestOptions, headers: Record<string, string>): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  // Honour a caller's signal as well as our timeout.
  opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    const text = await res.text();
    const body: unknown = text ? JSON.parse(text) : null;
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
    return { status: res.status, body, headers: h };
  } finally {
    clearTimeout(timer);
  }
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let raw: RawResponse;
  try {
    raw = Capacitor.isNativePlatform()
      ? await nativeRequest(url, opts, headers)
      : await webRequest(url, opts, headers);
  } catch (err) {
    // Offline, DNS failure, timeout, blocked. Not exceptional for this app.
    throw new ApiError(0, "offline", err instanceof Error ? err.message : "Network unavailable", true);
  }

  if (raw.status >= 200 && raw.status < 300) return raw.body as T;

  const body = (raw.body ?? {}) as { error?: string; message?: string };
  const retryAfter = raw.headers["retry-after"] ? Number(raw.headers["retry-after"]) : undefined;
  throw new ApiError(raw.status, body.error ?? "http_error", body.message ?? `HTTP ${raw.status}`, false, retryAfter);
}
