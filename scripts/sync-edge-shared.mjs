/**
 * Copies the framework-free backend modules into the Supabase Edge Function.
 *
 * The edge function must ship the SAME business logic the 90+ backend tests
 * exercise — services, providers, schema, env. Deno cannot import Node's
 * NodeNext-style `./x.js` specifiers for `.ts` files, so this script copies each
 * shared module into `supabase/functions/api/shared/` rewriting only the
 * extension in relative imports. Nothing else changes — the parity test
 * (`backend/test/edge-parity.test.ts`) fails the suite if the copies ever drift
 * from their sources.
 *
 * Run after ANY change to a listed file:   node scripts/sync-edge-shared.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SRC_DIR = join(ROOT, "backend", "src");
export const DEST_DIR = join(ROOT, "supabase", "functions", "api", "shared");

/** Relative to backend/src. Only framework-free modules belong here — anything
 * importing Fastify must stay out (the edge HTTP layer is hand-ported). */
export const SHARED_FILES = [
  "env.ts",
  "db/schema.ts",
  "db/client.ts",
  "db/ddl.ts",
  "lib/phone.ts",
  "lib/http-errors.ts",
  "lib/admin-page.ts",
  "lib/pay-result-page.ts",
  "services/otp.ts",
  "services/tokens.ts",
  "services/entitlement.ts",
  "services/pricing.ts",
  "services/payment-flow.ts",
  "services/admin.ts",
  "providers/sms/index.ts",
  "providers/sms/console.ts",
  "providers/sms/kavenegar.ts",
  "providers/psp/index.ts",
  "providers/psp/zibal.ts",
  "providers/psp/zarinpal.ts",
  "providers/psp/fake.ts",
  "providers/psp/router.ts",
];

export const HEADER =
  "// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.\n";

/** The ONLY transform: relative `./x.js` / `../y.js` specifiers become `.ts` so
 * Deno resolves them. Bare specifiers (zod, jose, drizzle-orm, node:*) are
 * untouched — the function's deno.json import map handles those. */
export function transform(source) {
  return HEADER + source.replace(/(from\s+["'])(\.\.?\/[^"']+)\.js(["'])/g, "$1$2.ts$3");
}

export function syncAll() {
  const written = [];
  for (const rel of SHARED_FILES) {
    const src = readFileSync(join(SRC_DIR, rel), "utf8");
    const dest = join(DEST_DIR, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, transform(src));
    written.push(rel);
  }
  return written;
}

// Run directly (not imported by the parity test).
if (
  process.argv[1] &&
  import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href
) {
  const files = syncAll();
  console.log(`[sync-edge-shared] copied ${files.length} files -> supabase/functions/api/shared/`);
}
