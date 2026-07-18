import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // PGlite boots a WASM Postgres per file; the default 5s is tight on a cold run.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
