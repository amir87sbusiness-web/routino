/**
 * Iranian mobile number canonicalisation — server copy.
 *
 * MUST stay behaviourally identical to `src/lib/phone.ts` on the client.
 * `users.phone` is unique, so any divergence FORKS AN ACCOUNT: the same human
 * signs in from two devices, normalises to two different strings, gets two
 * `users` rows, and their synced data splits in half with no error anywhere.
 *
 * `backend/test/phone.parity.test.ts` imports both implementations and compares
 * them over a shared vector list. If you change one, that test fails — change
 * both. (These converge into a shared package once the backend stabilises.)
 */

const PERSIAN_ZERO = 0x06f0; // ۰..۹
const ARABIC_ZERO = 0x0660; // ٠..٩

/** Convert Persian/Arabic-Indic digits to ASCII. The UI renders every number
 * through `faNum`, and Persian keyboards emit these codepoints, so user input
 * routinely contains them. Note `\d` and `[^\d]` only ever match ASCII, so
 * stripping non-digits *before* this conversion deletes the number entirely. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= PERSIAN_ZERO ? PERSIAN_ZERO : ARABIC_ZERO;
    return String(code - base);
  });
}

/**
 * Returns the canonical form `989xxxxxxxxx`, or null if not a valid IR mobile.
 *
 * Accepts what users actually type: `09123334444`, `+989123334444`,
 * `00989123334444`, `9123334444`, `۰۹۱۲۳۳۳۴۴۴۴`, and any spaces/dashes/parens.
 *
 * Disambiguates by length rather than by stripping prefixes, because `98` is
 * both the country code and a real mobile prefix: `0998…` is a valid number
 * whose national form starts with `98`. Blind prefix-stripping would eat it.
 */
export function normalizePhone(input: string): string | null {
  const d = toAsciiDigits(input).replace(/\D/g, "");

  let national: string | null = null;
  if (d.length === 10 && d.startsWith("9")) national = d; // 9123334444
  else if (d.length === 11 && d.startsWith("09")) national = d.slice(1); // 09123334444
  else if (d.length === 12 && d.startsWith("989")) national = d.slice(2); // 989123334444 / +98…
  else if (d.length === 14 && d.startsWith("00989")) national = d.slice(4); // 00989123334444

  return national && /^9\d{9}$/.test(national) ? `98${national}` : null;
}

/** Display form for a canonical number: 989123334444 -> 09123334444. */
export function toLocalPhone(canonical: string): string {
  return canonical.startsWith("98") ? `0${canonical.slice(2)}` : canonical;
}
