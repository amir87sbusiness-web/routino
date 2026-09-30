const STORAGE_KEY = "routino:diagnostics:v1";
const MAX_EVENTS = 100;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DiagnosticName =
  | "api_error"
  | "api_offline"
  | "api_slow"
  | "ui_error"
  | "unhandled_error"
  | "unhandled_rejection"
  | "payment_step";

export interface DiagnosticEvent {
  name: DiagnosticName;
  at: number;
  meta: Record<string, string | number | boolean>;
}

interface DiagnosticInput {
  name: DiagnosticName;
  meta?: Record<string, unknown>;
}

const names = new Set<DiagnosticName>([
  "api_error",
  "api_offline",
  "api_slow",
  "ui_error",
  "unhandled_error",
  "unhandled_rejection",
  "payment_step",
]);

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Some WebViews/private contexts deny even reading the storage getter.
    return null;
  }
}

function normalizePath(raw: string): string {
  const withoutQuery = raw.split("?", 1)[0] ?? "/";
  return withoutQuery
    .replace(UUID, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .slice(0, 160);
}

function safeMeta(meta: Record<string, unknown> = {}): DiagnosticEvent["meta"] {
  const out: DiagnosticEvent["meta"] = {};

  if (typeof meta.path === "string") out.path = normalizePath(meta.path);
  if (typeof meta.route === "string") out.route = normalizePath(meta.route);
  if (["GET", "POST", "OPTIONS"].includes(String(meta.method))) out.method = String(meta.method);
  if (typeof meta.status === "number" && Number.isFinite(meta.status)) out.status = meta.status;
  if (typeof meta.durationMs === "number" && Number.isFinite(meta.durationMs)) {
    out.durationMs = Math.max(0, Math.round(meta.durationMs));
  }
  if (typeof meta.offline === "boolean") out.offline = meta.offline;
  if (typeof meta.timeout === "boolean") out.timeout = meta.timeout;
  if (typeof meta.requestId === "string" && UUID_V4.test(meta.requestId)) {
    out.requestId = meta.requestId;
  }
  if (["api", "react", "window", "promise"].includes(String(meta.source))) {
    out.source = String(meta.source);
  }
  if (typeof meta.code === "string" && /^[a-z0-9_-]{1,48}$/i.test(meta.code)) {
    out.code = meta.code;
  }
  if (
    typeof meta.step === "string" &&
    [
      "checkout_started",
      "checkout_ready",
      "checkout_error",
      "redirect_requested",
      "redirect_opened",
      "return_received",
      "result_received",
      "app_context",
    ].includes(meta.step)
  )
    out.step = meta.step;
  if (["web", "android", "ios"].includes(String(meta.platform)))
    out.platform = String(meta.platform);
  for (const key of ["paymentId", "attemptId"] as const) {
    if (typeof meta[key] === "string" && UUID_V4.test(meta[key])) out[key] = meta[key];
  }
  if (typeof meta.build === "string" && /^\d{1,9}$/.test(meta.build)) out.build = meta.build;
  if (
    typeof meta.paymentStatus === "string" &&
    [
      "pending",
      "requesting",
      "redirected",
      "verifying",
      "provider_unknown",
      "paid",
      "failed",
      "canceled",
      "verify_failed",
      "manual_review",
    ].includes(meta.paymentStatus)
  )
    out.paymentStatus = meta.paymentStatus;

  return out;
}

let nativeContextRequested = false;
export function recordPaymentStep(step: string, meta: Record<string, unknown> = {}): void {
  recordDiagnostic({ name: "payment_step", meta: { ...meta, step } });
  if (nativeContextRequested || !["android", "ios"].includes(String(meta.platform))) return;
  nativeContextRequested = true;
  // Best effort device context. Never await it on checkout or make a network request.
  void import("@capacitor/app")
    .then(({ App }) => App.getInfo())
    .then(({ build }) =>
      recordDiagnostic({
        name: "payment_step",
        meta: { step: "app_context", platform: meta.platform, build },
      }),
    )
    .catch(() => {});
}

export function readDiagnostics(now = Date.now()): DiagnosticEvent[] {
  const target = storage();
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) throw new TypeError("Invalid diagnostic store");
    const cutoff = now - RETENTION_MS;
    return parsed
      .filter(
        (event): event is DiagnosticEvent =>
          typeof event === "object" &&
          event !== null &&
          names.has((event as DiagnosticEvent).name) &&
          Number.isFinite((event as DiagnosticEvent).at) &&
          (event as DiagnosticEvent).at >= cutoff,
      )
      .slice(-MAX_EVENTS)
      .map((event) => ({ ...event, meta: safeMeta(event.meta) }));
  } catch {
    try {
      target.removeItem(STORAGE_KEY);
    } catch {
      // Storage denial is itself not useful enough to risk another failure.
    }
    return [];
  }
}

export function recordDiagnostic(input: DiagnosticInput, now = Date.now()): void {
  const target = storage();
  if (!target || !names.has(input.name)) return;
  const events = [
    ...readDiagnostics(now),
    { name: input.name, at: now, meta: safeMeta(input.meta) },
  ].slice(-MAX_EVENTS);
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Diagnostics must never interfere with the app when storage is full.
  }
}

export function clearDiagnostics(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Best effort.
  }
}

export function exportDiagnostics(now = Date.now()): string {
  return JSON.stringify(
    {
      format: "routino-diagnostics",
      version: 1,
      exportedAt: now,
      events: readDiagnostics(now),
    },
    null,
    2,
  );
}
