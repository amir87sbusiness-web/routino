/** App-level behaviour of the edge function: health, CORS, the proxy-secret
 * gate (the edge analogue of TRUST_PROXY), and error shapes. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/harness.ts";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

describe("health", () => {
  it("GET /health is up", async () => {
    const res = await h.call("GET", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /health/ready proves the database is reachable", async () => {
    const res = await h.call("GET", "/health/ready");
    expect(res.status).toBe(200);
    expect((await res.json()).db).toBe("up");
  });
});

describe("cors", () => {
  it("answers a preflight from an allowed origin", async () => {
    const res = await h.app.request("/api/v1/plans", {
      method: "OPTIONS",
      headers: {
        origin: "https://routino.me",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://routino.me");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not reflect a disallowed origin", async () => {
    const res = await h.app.request("/api/v1/plans", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeFalsy();
  });
});

describe("proxy-secret gate", () => {
  it("when set, blocks requests without the worker header but keeps /health open", async () => {
    const guarded = await makeHarness({ PROXY_SECRET: "s3cret-s3cret" });
    try {
      // No header → blocked.
      expect((await guarded.call("GET", "/v1/plans")).status).toBe(403);
      // Right header → served.
      const ok = await guarded.call("GET", "/v1/plans", {
        headers: { "x-proxy-secret": "s3cret-s3cret" },
      });
      expect(ok.status).toBe(200);
      // Wrong header → blocked.
      const bad = await guarded.call("GET", "/v1/plans", {
        headers: { "x-proxy-secret": "wrong" },
      });
      expect(bad.status).toBe(403);
      // Health stays open for uptime monitors.
      expect((await guarded.call("GET", "/health")).status).toBe(200);
    } finally {
      await guarded.close();
    }
  });

  it("when unset (dev/tests), everything is open", async () => {
    expect((await h.call("GET", "/v1/plans")).status).toBe(200);
  });
});

describe("error shapes", () => {
  it("unknown routes return the JSON 404 contract", async () => {
    const res = await h.call("GET", "/v1/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("zod validation failures are 400 invalid_request", async () => {
    const res = await h.call("POST", "/v1/auth/otp/request", { body: { nope: true } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
  });
});

describe("plans", () => {
  it("serves the seeded plans in the client's shape", async () => {
    const res = await h.call("GET", "/v1/plans");
    const { plans } = await res.json();
    expect(plans).toHaveLength(3);
    expect(plans.find((p: { id: string }) => p.id === "m12").price).toBe(449000);
  });
});
