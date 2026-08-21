/**
 * A static guard against a class of bug the test suite structurally cannot
 * catch: node-postgres (the Fastify backend) silently serialises a raw JS
 * `Date` object bound into a query, but postgres.js — the driver the DEPLOYED
 * edge function actually runs on Deno — does not. It throws
 * `ERR_INVALID_ARG_TYPE: Received an instance of Date` while trying to encode
 * the parameter, BEFORE the query is even sent — so a `::timestamptz` cast in
 * the SQL text does not rescue it; that only tells Postgres how to interpret a
 * string that has already arrived. The value must be a real JS string
 * (`.toISOString()`) before it is spliced in. (An earlier version of this file
 * only checked for the SQL-side cast, which is why a supposedly-fixed version
 * of this bug still crashed production on the very next deploy.)
 *
 * `backend/test/helpers/pglite.ts` and `supabase/tests/helpers/harness.ts`
 * both run every test against PGlite via `drizzle-orm/pglite`, which tolerates
 * a raw Date fine — so this had 210 backend tests and 83 edge tests passing
 * while `/v1/auth/otp/request` 500'd on every real call in production. Nothing
 * short of running the real postgres.js driver would catch it dynamically,
 * which is not feasible in this suite, so this checks the source text instead:
 * every `${…}` splice in a raw `sql` template that looks like a Date must
 * either call `.toISOString()` inline, or be a bare identifier whose name ends
 * in `Iso` (the convention this codebase now uses — see `nowIso`, `sinceIso`,
 * `expiresIso` in otp.ts and payment-flow.ts).
 *
 * Necessarily heuristic (source text, not a real parser) — a function CALL
 * splice like `${at(60)}` cannot be verified this way and is deliberately not
 * flagged; it relies on the helper itself being named/reviewed to return a
 * string, the way `atIso` in otp.ts does. False negatives on an unusual shape
 * are possible; a bare Date-shaped identifier or an un-stringified `new
 * Date(...)` is not, and that is exactly the pattern that broke production.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILES = [
  "../src/services/otp.ts",
  "../src/services/payment-flow.ts",
  "../src/services/sync.ts",
  "../src/services/entitlement.ts",
];

/** Bare identifier names that are Date-typed by convention in this codebase.
 * Matched as the WHOLE trimmed splice content, so `nowIso` never matches `now`. */
const UNSAFE_BARE_NAMES = new Set([
  "now",
  "t",
  "since",
  "claimed",
  "createdAt",
  "updatedAt",
  "expiresAt",
  "expiresBefore",
  "expiresAfter",
  "paidAt",
]);

/**
 * The naming convention (`nowIso`, `atIso`, …) only protects anyone if the
 * variable's OWN definition actually calls `.toISOString()` — a rename that
 * keeps the "Iso" suffix but drops the call would satisfy the splice-side
 * check below while silently reintroducing the exact bug it exists to catch.
 * So every `const <name>Iso = …` / `const <name>Iso = (…) => …` in the file is
 * required to contain `.toISOString()` somewhere in its own right-hand side.
 */
function findUndefinedIsoNames(source: string): string[] {
  const problems: string[] = [];
  for (const m of source.matchAll(/const\s+(\w*Iso)\s*=\s*([^;]+);/g)) {
    const [, name, rhs] = m;
    if (!/\.toISOString\(\)/.test(rhs!)) problems.push(name!);
  }
  return problems;
}

function findUnsafeDateSplices(source: string): string[] {
  const problems: string[] = [];
  const sqlBlocks = [...source.matchAll(/sql`([\s\S]*?)`/g)].map((m) => m[1]!);
  for (const block of sqlBlocks) {
    for (const m of block.matchAll(/\$\{([^}]*)\}/g)) {
      const inner = m[1]!.trim();
      const hasIsoCall = /\.toISOString\(\)/.test(inner);
      const isNewDate = /\bnew\s+Date\(/.test(inner);
      const isBareUnsafeName = UNSAFE_BARE_NAMES.has(inner);
      if ((isNewDate && !hasIsoCall) || (isBareUnsafeName && !hasIsoCall)) {
        problems.push(m[0]);
      }
    }
  }
  return problems;
}

describe("raw SQL Date parameters are stringified before they reach the driver", () => {
  for (const rel of FILES) {
    it(`${rel} never splices a bare Date into a raw sql\`…\` block`, () => {
      const path = fileURLToPath(new URL(rel, import.meta.url));
      const source = readFileSync(path, "utf8");
      const problems = findUnsafeDateSplices(source);
      expect(
        problems,
        `unstringified Date interpolation(s) in raw SQL: ${problems.join(", ")}`,
      ).toEqual([]);
    });

    it(`${rel}: every *Iso variable actually calls .toISOString()`, () => {
      const path = fileURLToPath(new URL(rel, import.meta.url));
      const source = readFileSync(path, "utf8");
      const problems = findUndefinedIsoNames(source);
      expect(problems, `named *Iso but never calls .toISOString(): ${problems.join(", ")}`).toEqual(
        [],
      );
    });
  }
});
