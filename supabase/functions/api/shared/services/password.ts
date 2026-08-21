// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * Password hashing + credential validation.
 *
 * Hashing is scrypt from `node:crypto` — deliberately NOT the `argon2` npm
 * addon, which is a native binding that cannot load on the Supabase Edge (Deno)
 * runtime this file is shared with. scrypt is memory-hard, ships in the standard
 * library of both runtimes, and the existing shared code already leans on
 * `node:crypto` (randomBytes/timingSafeEqual) on the edge.
 *
 * The stored form is self-describing — `scrypt$N$r$p$saltB64$hashB64` — so the
 * work factor can be raised later without invalidating existing hashes: verify
 * reads the parameters back out of each stored value.
 */
// node: specifiers (not the globals) so this runs unchanged on Deno.
import { Buffer } from "node:buffer";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { toAsciiDigits } from "../lib/phone.ts";

/** cost=2^15, r=8, p=1 → ~32MB, a few ms per hash. Slow enough that online
 * guessing is hopeless, fast enough not to stall a sign-in. */
const N = 32_768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_LEN = 16;
// 128 * N * r = 32MB; give scrypt headroom so it never trips the default maxmem.
const MAXMEM = 64 * 1024 * 1024;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p, maxmem: MAXMEM }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

/** Returns `scrypt$N$r$p$saltB64$hashB64`. */
export async function hashPassword(raw: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(raw, salt, KEYLEN, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** Constant-time verify. Any malformed stored value is a non-match, never a throw. */
export async function verifyPassword(raw: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected: Buffer;
  let salt: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64");
    expected = Buffer.from(parts[5]!, "base64");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const derived = await scryptAsync(raw, salt, expected.length, n, r, p);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * A stable dummy hash. Verifying a wrong password against THIS when no account
 * matches keeps the timing of "no such user" the same as "wrong password", so
 * the endpoint can't be used to enumerate who has an account.
 */
export const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(SALT_LEN).toString("base64")}$${Buffer.alloc(KEYLEN).toString("base64")}`;

export type PasswordReason = "too_short" | "too_long" | "needs_letter_and_digit";

/** Minimum viable strength: 8+ chars with at least one letter and one digit.
 * Deliberately lenient — length is what matters most, and slow hashing plus
 * lockouts carry the rest. */
export function validatePassword(
  raw: string,
): { ok: true } | { ok: false; reason: PasswordReason } {
  if (typeof raw !== "string" || raw.length < 8) return { ok: false, reason: "too_short" };
  if (raw.length > 128) return { ok: false, reason: "too_long" };
  if (!/[A-Za-z]/.test(raw) || /[0-9]/.test(raw) === false)
    return { ok: false, reason: "needs_letter_and_digit" };
  return { ok: true };
}

export type UsernameReason = "too_short" | "too_long" | "bad_chars" | "reserved";

/**
 * Names nobody may claim: impersonation-prone handles (admin, support, official)
 * and app/system words. Compared against the normalized (lowercased) username, so
 * "Admin", "ADMIN" and "admin" are all blocked. Uniqueness handles the rest — two
 * people can never share a name — this only carves out the sensitive few.
 */
export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "administrador",
  "root",
  "superuser",
  "sysadmin",
  "system",
  "sys",
  "support",
  "help",
  "helpdesk",
  "moderator",
  "mod",
  "owner",
  "staff",
  "team",
  "official",
  "security",
  "routino",
  "routinoapp",
  "api",
  "www",
  "null",
  "undefined",
]);

/** Lowercased ASCII, Persian digits folded to ASCII, whitespace trimmed. */
export function normalizeUsername(raw: string): string {
  return toAsciiDigits(raw).trim().toLowerCase();
}

/**
 * Folds the digit-for-letter substitutions and separators used to slip past a
 * reserved-name list — `adm1n`, `supp0rt`, `r00t`, `s_t_a_f_f`.
 *
 * Used ONLY to test against RESERVED_USERNAMES; the stored username is always
 * the plain normalized form. This is an impersonation guard, not a security
 * boundary: someone messaging users as apparent staff is a social-engineering
 * risk precisely because those users are about to send money through the app.
 */
function foldLookalikes(v: string): string {
  return v
    .replace(/[._]/g, "")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/\$/g, "s");
}

/** True when a name is reserved outright or is a lookalike of one. */
export function isReservedUsername(normalized: string): boolean {
  if (RESERVED_USERNAMES.has(normalized)) return true;
  const folded = foldLookalikes(normalized);
  if (RESERVED_USERNAMES.has(folded)) return true;
  // `routino_support`, `admin-team`, `official.routino` — a reserved word as a
  // whole segment reads as staff regardless of what surrounds it.
  return (
    folded.length <= 32 && [...RESERVED_USERNAMES].some((r) => r.length >= 4 && folded.includes(r))
  );
}

/**
 * 3–24 chars, `a-z 0-9 _ .`, MUST start with a letter, and not a reserved name.
 *
 * The leading-letter rule is load-bearing: it guarantees a username can never
 * normalize to a phone number, so the login endpoint can decide "phone vs
 * username" purely by whether `normalizePhone` succeeds — no ambiguity.
 */
export function validateUsername(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: UsernameReason } {
  const v = normalizeUsername(raw);
  if (v.length < 3) return { ok: false, reason: "too_short" };
  if (v.length > 24) return { ok: false, reason: "too_long" };
  if (!/^[a-z][a-z0-9_.]*$/.test(v)) return { ok: false, reason: "bad_chars" };
  if (isReservedUsername(v)) return { ok: false, reason: "reserved" };
  return { ok: true, value: v };
}
