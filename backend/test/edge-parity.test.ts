/**
 * Edge/backend parity.
 *
 * The Supabase Edge Function ships COPIES of the backend's framework-free
 * modules (services, providers, schema, env). Everything this suite proves about
 * OTP, tokens, pricing, entitlement and the PSPs is only true in production if
 * those copies are byte-identical to their sources (modulo the mechanical
 * `.js`→`.ts` import rewrite). Same idea as the phone.ts client/server parity
 * test — if this fails, run:  node scripts/sync-edge-shared.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module, no types needed.
import { DEST_DIR, SHARED_FILES, SRC_DIR, transform } from "../../scripts/sync-edge-shared.mjs";

describe("edge shared-code parity", () => {
  it.each(SHARED_FILES as string[])("%s matches its edge copy", (rel) => {
    const src = readFileSync(join(SRC_DIR as string, rel), "utf8");
    let copy: string;
    try {
      copy = readFileSync(join(DEST_DIR as string, rel), "utf8");
    } catch {
      throw new Error(`edge copy missing for ${rel} — run: node scripts/sync-edge-shared.mjs`);
    }
    expect(copy).toBe(transform(src));
  });
});
