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
    /** No usable network response. The server may still have received a POST. */
    readonly offline = false,
    readonly retryAfter?: number,
    readonly support?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Browser HTTP-cache mode. Use `no-store` for server-authoritative dynamic
   * data such as subscription prices so an older cached response cannot win. */
  cache?: RequestCache;
  /** Lets a small web request continue while the page is being hidden. Native
   * HTTP has its own lifecycle and ignores this browser-only hint. */
  keepalive?: boolean;
}

interface RawResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function waitForNativeResponse<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", aborted, { once: true });
    request.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", aborted);
        reject(err);
      },
    );
  });
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
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (opts.cache === "no-store") {
    headers["Cache-Control"] = "no-cache";
    headers.Pragma = "no-cache";
  }
  const res = await waitForNativeResponse(
    CapacitorHttp.request({
      url,
      method: opts.method ?? "GET",
      headers,
      data: opts.body,
      connectTimeout: opts.timeoutMs ?? 15_000,
      readTimeout: opts.timeoutMs ?? 15_000,
    }),
    opts.signal,
  );
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers ?? {})) {
    normalizedHeaders[key.toLowerCase()] = String(value);
  }
  let body: unknown = res.data;
  if (typeof body === "string") {
    try {
      body = body ? JSON.parse(body) : null;
    } catch {
      throw new ApiError(res.status, "invalid_response", "Server returned an unreadable response");
    }
  }
  return {
    status: res.status,
    body,
    headers: normalizedHeaders,
  };
}

async function webRequest(
  url: string,
  opts: RequestOptions,
  headers: Record<string, string>,
): Promise<RawResponse> {
  if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? 15_000);
  // Honour a caller's signal as well as our timeout.
  const abortFromCaller = () => controller.abort();
  opts.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
      cache: opts.cache,
      keepalive: opts.keepalive,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(res.status, "invalid_response", "Server returned an unreadable response");
    }
    const h: Record<string, string> = {};
    res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
    return { status: res.status, body, headers: h };
  } catch (err) {
    if (timedOut && !opts.signal?.aborted) {
      throw new ApiError(0, "timeout", "Server response timed out", true);
    }
    throw err;
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
    const timeout =
      !opts.signal?.aborted &&
      (err instanceof ApiError
        ? err.code === "timeout"
        : err instanceof Error &&
          (err.name === "TimeoutError" ||
            /SocketTimeoutException|timed out|timeout/i.test(err.message)));
    if (err instanceof ApiError && !err.offline) {
      recordDiagnostic({
        name: "api_error",
        meta: {
          source: "api",
          path,
          method: opts.method ?? "GET",
          status: err.status,
          code: err.code,
        },
      });
      throw err;
    }
    // Offline, DNS failure, timeout, blocked. Not exceptional for this app.
    recordDiagnostic({
      name: "api_offline",
      meta: {
        source: "api",
        path,
        method: opts.method ?? "GET",
        durationMs: performance.now() - startedAt,
        offline: true,
        timeout,
      },
    });
    throw new ApiError(
      0,
      timeout ? "timeout" : "offline",
      timeout ? "Server response timed out" : "Network unavailable",
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
