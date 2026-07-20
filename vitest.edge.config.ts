import { defineConfig } from "vitest/config";

/**
 * Runner for the Supabase Edge Function suite (`npm run test:edge`).
 *
 * The Hono app under supabase/functions/api is runtime-agnostic (fetch-based),
 * so it runs under Node here against PGlite — same technique as the backend
 * suite. Only the Deno entry (index.ts: Deno.serve + postgres-js) is outside
 * test reach; everything it wires is exercised.
 *
 * Kept separate from the frontend config: node environment (not jsdom), and the
 * frontend `npm test` excludes supabase/** for the same reason.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["supabase/tests/**/*.test.ts"],
    // PGlite schema bootstrap makes cold starts slow-ish; generous timeouts
    // beat flaky CI.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
