import { describe, expect, it, vi } from "vitest";
import { runLoadSmoke } from "./load-smoke.mjs";

describe("local load smoke reporting", () => {
  it("uses only real public read paths and reports latency plus response bytes", async () => {
    const calledPaths = [];
    const fetchImpl = vi.fn(async (url) => {
      calledPaths.push(url.pathname);
      return new Response(url.pathname === "/health" ? "ok" : "[]", { status: 200 });
    });

    const report = await runLoadSmoke({
      baseUrl: "http://127.0.0.1:3000",
      requests: 4,
      concurrency: 1,
      fetchImpl,
    });

    expect(calledPaths).toEqual(["/health", "/v1/plans", "/health", "/v1/plans"]);
    expect(calledPaths).not.toContain("/v1/devices/ping");
    expect(report.latencyMs).toHaveProperty("p99");
    expect(report.responseBytes).toBe(8);
    expect(report.errors).toBe(0);
  });

  it("counts a path-unexpected 4xx as an error", async () => {
    const report = await runLoadSmoke({
      baseUrl: "http://localhost:3000",
      requests: 1,
      concurrency: 1,
      scenarios: [{ path: "/v1/plans", expectedStatuses: [200] }],
      fetchImpl: async () => new Response("missing", { status: 404 }),
    });

    expect(report.errors).toBe(1);
    expect(report.unexpectedResponses).toEqual([{ path: "/v1/plans", status: 404 }]);
    expect(report.statuses).toEqual({ 404: 1 });
  });

  it("counts transport failures without inventing response bytes", async () => {
    const report = await runLoadSmoke({
      baseUrl: "http://[::1]:3000",
      requests: 1,
      concurrency: 1,
      fetchImpl: async () => {
        throw new Error("connection refused");
      },
    });

    expect(report.errors).toBe(1);
    expect(report.responseBytes).toBe(0);
    expect(report.statuses).toEqual({ 0: 1 });
  });
});
