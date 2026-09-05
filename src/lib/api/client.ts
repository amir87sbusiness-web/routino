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
import { recordDiagnostic } from "../diagnostics";

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
    readonly support?: string,
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
  /** Lets a small web request continue while the page is being hidden. Native
   * HTTP has its own lifecycle and ignores this browser-only hint. */
  keepalive?: boolean;
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
async function nativeRequest(
  url: string,
  opts: RequestOptions,
  headers: Record<string, string>,
): Promise<RawResponse> {
  const { CapacitorHttp } = await import("@capacitor/core");
  const res = await CapacitorHttp.request({
    url,
    method: opts.method ?? "GET",
    headers,
    data: opts.body,
    connectTimeout: opts.timeoutMs ?? 15_000,
    readTimeout: opts.timeoutMs ?? 15_000,
  });
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers ?? {})) {
    normalizedHeaders[key.toLowerCase()] = String(value);
  }
  return {
    status: res.status,
    body: res.data,
    headers: normalizedHeaders,
  };
}

async function webRequest(
  url: string,
  opts: RequestOptions,
  headers: Record<string, string>,
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  // Honour a caller's signal as well as our timeout.
  const abortFromCaller = () => controller.abort();
  opts.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
      keepalive: opts.keepalive,
    });
    const text = await res.text();
    const body: unknown = text ? JSON.parse(text) : null;
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
    return { status: res.status, body, headers: h };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${BASE}${path}`;
  const startedAt = performance.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let raw: RawResponse;
  try {
    raw = Capacitor.isNativePlatform()
      ? await nativeRequest(url, opts, headers)
      : await webRequest(url, opts, headers);
  } catch (err) {
    // Offline, DNS failure, timeout, blocked. Not exceptional for this app.
    recordDiagnostic({
      name: "api_offline",
      meta: {
        source: "api",
        path,
        method: opts.method ?? "GET",
        durationMs: performance.now() - startedAt,
        offline: true,
        timeout: err instanceof DOMException && err.name === "AbortError",
      },
    });
    throw new ApiError(
      0,
      "offline",
      err instanceof Error ? err.message : "Network unavailable",
      true,
    );
  }

  const durationMs = performance.now() - startedAt;
  const requestId = raw.headers["x-request-id"];
  if (raw.status >= 200 && raw.status < 300) {
    if (durationMs >= 3_000) {
      recordDiagnostic({
        name: "api_slow",
        meta: {
          source: "api",
          path,
          method: opts.method ?? "GET",
          status: raw.status,
          durationMs,
          requestId,
        },
      });
    }
    return raw.body as T;
  }

  const body = (raw.body ?? {}) as { error?: string; message?: string; support?: string };
  const retryAfter = raw.headers["retry-after"] ? Number(raw.headers["retry-after"]) : undefined;
  recordDiagnostic({
    name: "api_error",
    meta: {
      source: "api",
      path,
      method: opts.method ?? "GET",
      status: raw.status,
      durationMs,
      requestId,
      code: body.error,
    },
  });
  throw new ApiError(
    raw.status,
    body.error ?? "http_error",
    body.message ?? `HTTP ${raw.status}`,
    false,
    retryAfter,
    body.support,
  );
}
