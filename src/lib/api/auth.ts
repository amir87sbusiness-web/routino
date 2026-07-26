/**
 * Session tokens and the auth endpoints.
 *
 * Tokens live under their OWN localStorage key, not in `routino:local:v1`:
 * `saveLocal` rewrites that key wholesale from React state on every persist, so
 * a second writer there would be a lost update — and the symptom would be
 * random sign-outs.
 *
 * The rule that matters most here: **being signed in is not the same as holding
 * a valid token.** The app gates on `db.auth`, which is device-local and set at
 * sign-in. A failed refresh, an expired token, or a dead backend must never sign
 * anyone out — offline has to be indistinguishable from online.
 */
import { apiRequest, ApiError } from "./client";

const TOKEN_KEY = "routino:auth:v1";

export interface Tokens {
  access: string;
  refresh: string;
  deviceId: string;
  /** Epoch ms when `access` expires, so we can refresh proactively. */
  accessExpiresAt: number;
}

export interface ServerEntitlement {
  status: "active" | "expired" | "none";
  planId: string | null;
  expiresAt: string | null;
  issuedAt: string;
}

/** Access tokens are ~15 min; refresh a little early to avoid a guaranteed 401. */
const REFRESH_SKEW_MS = 60_000;
const ASSUMED_ACCESS_TTL_MS = 15 * 60_000;

export function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
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
const withExpiry = (t: { access: string; refresh: string; deviceId: string }): Tokens => ({
  access: t.access,
  refresh: t.refresh,
  deviceId: t.deviceId,
  accessExpiresAt: Date.now() + ASSUMED_ACCESS_TTL_MS,
});

/* ---------------- endpoints ---------------- */

export async function requestOtp(phone: string): Promise<{ ok: boolean; retryAfter: number }> {
  return apiRequest("/auth/otp/request", { method: "POST", body: { phone } });
}

export interface VerifyResult {
  access: string;
  refresh: string;
  deviceId: string;
  user: { id: string; phone: string };
  entitlement: ServerEntitlement;
  isNew: boolean;
}

export async function verifyOtp(
  phone: string,
  code: string,
  deviceName?: string,
): Promise<VerifyResult> {
  const res = await apiRequest<VerifyResult>("/auth/otp/verify", {
    method: "POST",
    body: { phone, code, deviceName },
  });
  saveTokens(withExpiry(res));
  return res;
}

/** Password sign-in. `identifier` is a phone number OR a username; the server
 * decides which. Returns the same shape as OTP verify, so callers reuse the
 * same post-login flow. */
export async function passwordLogin(
  identifier: string,
  password: string,
  deviceName?: string,
): Promise<VerifyResult> {
  const res = await apiRequest<VerifyResult>("/auth/password/login", {
    method: "POST",
    body: { identifier, password, deviceName },
  });
  saveTokens(withExpiry(res));
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
export async function importSubscription(sub: {
  planId: string;
  expiresAt: number;
  startedAt?: number;
  trial?: boolean;
}): Promise<{ entitlement: ServerEntitlement; imported: boolean }> {
  return authedRequest("/subscriptions/import", { method: "POST", body: sub });
}

export async function fetchEntitlement(): Promise<{ entitlement: ServerEntitlement }> {
  return authedRequest("/subscriptions/me");
}

export async function logout(): Promise<void> {
  const tokens = loadTokens();
  clearTokens();
  if (!tokens) return;
  try {
    await apiRequest("/auth/logout", { method: "POST", body: { refresh: tokens.refresh } });
  } catch {
    // Local sign-out already happened; the server-side revoke is best-effort.
  }
}

/* ---------------- authed requests ---------------- */

/** Single-flight: concurrent 401s must not each rotate the refresh token —
 * rotation invalidates the previous one, so parallel refreshes would race and
 * all but one would fail. */
let refreshing: Promise<Tokens | null> | null = null;

async function refreshTokens(): Promise<Tokens | null> {
  const current = loadTokens();
  if (!current) return null;

  refreshing ??= (async () => {
    try {
      const res = await apiRequest<{ access: string; refresh: string; deviceId: string }>(
        "/auth/token/refresh",
        {
          method: "POST",
          body: { refresh: current.refresh },
        },
      );
      const next = withExpiry(res);
      saveTokens(next);
      return next;
    } catch (err) {
      // Only a definitive rejection means the session is dead. Offline must NOT
      // clear tokens — the user is still signed in, just unreachable.
      if (err instanceof ApiError && !err.offline && err.status === 401) clearTokens();
      return null;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

/** A request that carries the access token, refreshing once if it has expired. */
export async function authedRequest<T>(
  path: string,
  opts: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  let tokens = loadTokens();
  if (!tokens) throw new ApiError(401, "not_signed_in", "No session on this device");

  if (Date.now() >= tokens.accessExpiresAt - REFRESH_SKEW_MS) {
    tokens = (await refreshTokens()) ?? tokens; // fall through and let the server decide
  }

  try {
    return await apiRequest<T>(path, { ...opts, token: tokens.access });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const next = await refreshTokens();
      if (next) return apiRequest<T>(path, { ...opts, token: next.access });
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
