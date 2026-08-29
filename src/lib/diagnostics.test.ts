import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDiagnostics,
  exportDiagnostics,
  readDiagnostics,
  recordDiagnostic,
} from "./diagnostics";

const day = 24 * 60 * 60 * 1000;

beforeEach(() => localStorage.clear());

describe("local diagnostics", () => {
  it("keeps only the newest 100 safe technical events", () => {
    for (let i = 0; i < 120; i += 1) {
      recordDiagnostic({ name: "api_error", meta: { status: 500, durationMs: i } }, i + 1);
    }
    const events = readDiagnostics(121);
    expect(events).toHaveLength(100);
    expect(events[0]?.meta.durationMs).toBe(20);
    expect(events.at(-1)?.meta.durationMs).toBe(119);
  });

  it("prunes entries older than seven days", () => {
    recordDiagnostic({ name: "api_offline", meta: { path: "/sync/exchange" } }, 1);
    recordDiagnostic({ name: "api_offline", meta: { path: "/plans" } }, 8 * day);
    expect(readDiagnostics(8 * day)).toHaveLength(1);
  });

  it("recovers from invalid storage", () => {
    localStorage.setItem("routino:diagnostics:v1", "not-json");
    expect(readDiagnostics()).toEqual([]);
    expect(localStorage.getItem("routino:diagnostics:v1")).toBeNull();
  });

  it("drops secret and user-content fields and normalizes path identifiers", () => {
    recordDiagnostic({
      name: "api_error",
      meta: {
        path: "/devices/123e4567-e89b-42d3-a456-426614174000/revoke?phone=09120000000",
        status: 401,
        requestId: "123e4567-e89b-42d3-a456-426614174000",
        token: "secret",
        phone: "09120000000",
        message: "user-authored text",
        body: { private: true },
      },
    });
    expect(readDiagnostics()[0]?.meta).toEqual({
      path: "/devices/:id/revoke",
      status: 401,
      requestId: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it("exports a versioned support payload and can be cleared", () => {
    recordDiagnostic({ name: "ui_error", meta: { source: "react" } }, 100);
    const payload = JSON.parse(exportDiagnostics(200));
    expect(payload).toMatchObject({ format: "routino-diagnostics", version: 1, exportedAt: 200 });
    expect(payload.events).toHaveLength(1);
    clearDiagnostics();
    expect(readDiagnostics()).toEqual([]);
  });
});
