import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // jsdom supplies localStorage; fake-indexeddb (loaded in setup) supplies a
    // real IndexedDB, so the storage tests exercise actual Dexie code paths
    // rather than a mock of them.
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // The backend and the edge-function suite are separate projects with their
    // own runners (node env, PGlite). Without this, `npm test` here silently
    // runs those under jsdom too.
    exclude: ["**/node_modules/**", "**/dist/**", "backend/**", "supabase/**"],
  },
});
