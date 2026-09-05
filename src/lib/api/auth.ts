/**
 * Session tokens and the auth endpoints.
 *
 * Tokens live under their OWN localStorage key, not in `routino:local:v1`:
 * `saveLocal` rewrites that key wholesale from React state on every persist, so
 * a second writer there would be a lost update — and the symptom would be
 * random sign-outs.
 *
 * The app gates on `db.auth`, which is device-local and set at sign-in. The
 * signed access token is the complete server session and expires after 30 days.
 */
import { apiRequest, ApiError } from "./client";

const TOKEN_KEY = "routino:auth:v1";

export interface Tokens {
  access: string;
  /** Epoch ms when `access` expires. */
  accessExpiresAt: number;
  /** Last successful subscription read; absent on sessions created by older builds. */
  lastEntitlementCheckedAt?: number;
  /** Account cleanup deadline returned alongside existing account-state responses. */
  accountDeletionAt?: number;
}

export interface ServerEntitlement {
  status: "active" | "expired" | "none";
  planId: string | null;
  expiresAt: string | null;
  issuedAt: string;
  /** Missing on older servers; null means this account is protected from cleanup. */
  deletionAt?: string | null;
}

const FALLBACK_ACCESS_TTL_MS = 60 * 60_000;

function accessPayload(access: string): { exp?: unknown; sub?: unknown } | null {
  try {
    const segment = access.split(".")[1];
    if (!segment) return null;
    const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as { exp?: unknown; sub?: unknown };
  } catch {
    return null;
  }
}

export interface TrialStartResult {
  entitlement: ServerEntitlement;
  started: boolean;
  reason?: "previous_grant" | "entitlement_exists";
  /** Refreshed access token, capped to the account deletion deadline. */
  access?: string;
}

export function accessExpiryAt(access: string, now = Date.now()): number {
  const payload = accessPayload(access);
  if (typeof payload?.exp === "number" && Number.isFinite(payload.exp)) return payload.exp * 1000;
  // Old/corrupt tokens get one bounded server attempt; a 401 clears storage.
  return now + FALLBACK_ACCESS_TTL_MS;
}

export function accessSubject(access: string): string | null {
  const subject = accessPayload(access)?.sub;
  return typeof subject === "string" && subject ? subject : null;
}

export function sessionUserId(): string | null {
  const tokens = loadTokens();
  return tokens ? accessSubject(tokens.access) : null;
}

export function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Tokens>;
    if (typeof parsed.access !== "string" || !parsed.access) return null;
    const migrated: Tokens = {
      access: parsed.access,
      accessExpiresAt:
        typeof parsed.accessExpiresAt === "number"
          ? parsed.accessExpiresAt
          : accessExpiryAt(parsed.access),
      ...(typeof parsed.lastEntitlementCheckedAt === "number"
        ? { lastEntitlementCheckedAt: parsed.lastEntitlementCheckedAt }
        : {}),
      ...(typeof parsed.accountDeletionAt === "number" && Number.isFinite(parsed.accountDeletionAt)
        ? { accountDeletionAt: parsed.accountDeletionAt }
        : {}),
    };
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) saveTokens(migrated);
    return migrated;
  } catch {
    return null;
  }
}

export function saveTokens(t: Tokens): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
  } catch {
    /* storage full — sync will just re-auth later */
  }
}

export function clearTokens(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Picks only the token fields: callers pass whole API responses, and the store
 * must not accumulate a stale copy of `entitlement`/`user` alongside them. */
const withExpiry = (
  t: { access: string },
  previous?: Pick<Tokens, "lastEntitlementCheckedAt" | "accountDeletionAt">,
  entitlementCheckedAt?: number,
  entitlement?: ServerEntitlement,
): Tokens => {
  const now = Date.now();
  let deletionAt = previous?.accountDeletionAt;
  if (entitlement && Object.hasOwn(entitlement, "deletionAt")) {
    const parsed = entitlement.deletionAt ? Date.parse(entitlement.deletionAt) : Number.NaN;
    deletionAt = Number.isFinite(parsed) ? parsed : undefined;
  }
  return {
    access: t.access,
    accessExpiresAt: accessExpiryAt(t.access, now),
    lastEntitlementCheckedAt: entitlementCheckedAt ?? previous?.lastEntitlementCheckedAt,
    ...(deletionAt !== undefined ? { accountDeletionAt: deletionAt } : {}),
  };
};

export function markEntitlementChecked(entitlement?: ServerEntitlement, now = Date.now()): void {
  const tokens = loadTokens();
  if (tokens) saveTokens(withExpiry(tokens, tokens, now, entitlement));
}

export function accountDeletionAt(): number | null {
  return loadTokens()?.accountDeletionAt ?? null;
}

/* ---------------- endpoints ---------------- */

export async function requestOtp(phone: string): Promise<{ ok: boolean; retryAfter: number }> {
  return apiRequest("/auth/otp/request", { method: "POST", body: { phone } });
}

export interface VerifyResult {
  access: string;
  user: { id: string; phone: string };
  entitlement: ServerEntitlement;
  isNew: boolean;
}

export interface VerifyOtpOptions {
  intent?: "signup" | "password_reset";
  newPassword?: string;
}

export async function verifyOtp(
  phone: string,
  code: string,
  options: VerifyOtpOptions = {},
): Promise<VerifyResult> {
  const res = await apiRequest<VerifyResult>("/auth/otp/verify", {
    method: "POST",
    body: {
      phone,
      code,
      ...(options.intent ? { intent: options.intent, newPassword: options.newPassword } : {}),
    },
  });
  saveTokens(withExpiry(res, undefined, Date.now(), res.entitlement));
  return res;
}

/** Password sign-in. `identifier` is a phone number OR a username; the server
 * decides which. Returns the same shape as OTP verify, so callers reuse the
 * same post-login flow. */
export async function passwordLogin(identifier: string, password: string): Promise<VerifyResult> {
  const res = await apiRequest<VerifyResult>("/auth/password/login", {
    method: "POST",
    body: { identifier, password },
  });
  saveTokens(withExpiry(res, undefined, Date.now(), res.entitlement));
  return res;
}

export interface AccountInfo {
  phone: string;
  username: string | null;
  hasPassword: boolean;
}

/** The signed-in account's credential state, for the settings screen. */
export async function fetchAccount(): Promise<AccountInfo> {
  return authedRequest("/auth/account");
}

export async function setUsername(username: string): Promise<{ ok: boolean; username: string }> {
  return authedRequest("/auth/username", { method: "POST", body: { username } });
}

/** Sets the first password (no `currentPassword`) or changes an existing one. */
export async function setPassword(
  newPassword: string,
  currentPassword?: string,
): Promise<{ ok: boolean }> {
  return authedRequest("/auth/password", {
    method: "POST",
    body: { newPassword, currentPassword },
  });
}

/** Imports a legacy local subscription. Bounded and single-use server-side. */
export async function importSubscription(
  sub: {
    planId: string;
    expiresAt: number;
    startedAt?: number;
    trial?: boolean;
  },
  expectedUserId: string,
): Promise<{ entitlement: ServerEntitlement; imported: boolean }> {
  return authedRequest("/subscriptions/import", {
    method: "POST",
    body: sub,
    expectedUserId,
  });
}

export async function fetchEntitlement(): Promise<{ entitlement: ServerEntitlement }> {
  const result = await authedRequest<{ entitlement: ServerEntitlement }>("/subscriptions/me");
  markEntitlementChecked(result.entitlement);
  return result;
}

/** Starts the server-owned seven-day trial. The client never constructs dates. */
export async function startTrial(): Promise<TrialStartResult> {
  const result = await authedRequest<TrialStartResult>("/subscriptions/trial/start", {
    method: "POST",
  });
  const current = loadTokens();
  if (result.access && current) {
    saveTokens(withExpiry(result as { access: string }, current, Date.now(), result.entitlement));
  } else {
    markEntitlementChecked(result.entitlement);
  }
  return result;
}

export async function logout(): Promise<void> {
  clearTokens();
}

/* ---------------- authed requests ---------------- */
/** A request that carries the stored access token exactly once. */
export async function authedRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST";
    body?: unknown;
    expectedUserId?: string;
    keepalive?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const { expectedUserId, ...requestOptions } = opts;
  const tokens = loadTokens();
  if (!tokens) throw new ApiError(401, "not_signed_in", "No session on this device");

  const assertExpectedOwner = (access: string) => {
    if (expectedUserId && accessSubject(access) !== expectedUserId) {
      throw new ApiError(401, "session_changed", "The active account changed during this request");
    }
  };
  assertExpectedOwner(tokens.access);

  if (Date.now() >= tokens.accessExpiresAt) {
    clearTokens();
    throw new ApiError(401, "not_signed_in", "The access token expired");
  }

  try {
    return await apiRequest<T>(path, { ...requestOptions, token: tokens.access });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      clearTokens();
    }
    throw err;
  }
}

/** True when this device has ever completed sign-in. Deliberately independent of
 * whether the tokens currently work. */
export const hasSession = (): boolean => loadTokens() !== null;

/**
 * Maps a server entitlement onto the local `Subscription` the UI already reads.
 *
 * The paywall still consults the local field (flipping it to read the server
 * directly is deliberately the LAST change, since a bug there means nobody can
 * open the app). This keeps the local copy as a cache of the server's answer.
 */
export function entitlementToSubscription(
  e: ServerEntitlement,
  now = Date.now(),
): { planId: string; startedAt: number; expiresAt: number; trial: boolean } | null {
  if (!e.expiresAt || e.status === "none") return null;
  return {
    planId: e.planId ?? "unknown",
    startedAt: now,
    expiresAt: Date.parse(e.expiresAt),
    trial: e.planId === "trial",
  };
}
