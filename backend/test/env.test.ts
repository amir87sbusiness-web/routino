import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";

describe("provider capacity environment", () => {
  it("has bounded production-safe defaults", () => {
    const env = loadEnv({ NODE_ENV: "test" });
    expect(env.SMS_PROVIDER_MAX_CONCURRENCY).toBe(32);
    expect(env.PSP_PROVIDER_MAX_CONCURRENCY).toBe(64);
  });

  it.each(["0", "1001", "1.5", "nope"])("rejects invalid concurrency %s", (value) => {
    expect(() => loadEnv({ NODE_ENV: "test", SMS_PROVIDER_MAX_CONCURRENCY: value })).toThrow();
    expect(() => loadEnv({ NODE_ENV: "test", PSP_PROVIDER_MAX_CONCURRENCY: value })).toThrow();
  });
});
