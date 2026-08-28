import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadEnv, testProviderWarnings } from "../src/env.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

describe("health", () => {
  it("responds ok", async () => {
    const res = await h.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("reports the database as reachable", async () => {
    // Proves PGlite really is wired through the app, not stubbed.
    const res = await h.app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: "up" });
  });
});

describe("request IDs", () => {
  it("preserves a valid caller ID on the response", async () => {
    const requestId = "123e4567-e89b-42d3-a456-426614174000";
    const res = await h.app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": requestId },
    });
    expect(res.headers["x-request-id"]).toBe(requestId);
  });

  it("replaces missing or unsafe IDs with UUIDs", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/v1/nope",
      headers: { "x-request-id": "phone-or-secret" },
    });
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("GET /v1/plans", () => {
  it("returns the active plans in the client's Plan shape, priced in Toman", async () => {
    const res = await h.app.inject({ method: "GET", url: "/v1/plans" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { plans: { id: string; price: number; months: number }[] };
    expect(body.plans.map((p) => p.id).sort()).toEqual(["m1", "m12", "m3"]);
    // Must match src/lib/presets.ts, or the displayed price and the charge diverge.
    expect(body.plans.find((p) => p.id === "m1")).toMatchObject({ price: 59000, months: 1 });
    expect(body.plans.find((p) => p.id === "m12")).toMatchObject({ price: 449000, months: 12 });
  });

  it("hides inactive plans", async () => {
    await h.raw(`update plans set active = false where id = 'm1'`);
    const res = await h.app.inject({ method: "GET", url: "/v1/plans" });
    expect((res.json() as { plans: unknown[] }).plans).toHaveLength(2);
  });
});

describe("production env guards", () => {
  const prod = {
    NODE_ENV: "production",
    DB_DRIVER: "postgres",
    JWT_SECRET: "x".repeat(40),
    OTP_PEPPER: "y".repeat(20),
    ADMIN_TOKEN: "z".repeat(20),
    SMS_PROVIDER: "kavenegar",
    KAVENEGAR_API_KEY: "k",
    PSP_PROVIDER: "zarinpal",
    ZARINPAL_MERCHANT: "11111111-2222-4333-8444-555555555555",
  } as const;

  it("requires a valid ZarinPal merchant UUID", () => {
    expect(() => loadEnv({ ...prod, ZARINPAL_MERCHANT: "bad" })).toThrow(/ZARINPAL_MERCHANT/);
    expect(() => loadEnv(prod)).not.toThrow();
  });

  it("defaults access tokens to one hour because every protected call rechecks the device row", () => {
    expect(loadEnv({ NODE_ENV: "test" }).ACCESS_TTL_SECONDS).toBe(3600);
  });

  it("refuses to start with console SMS", () => {
    expect(() => loadEnv({ ...prod, SMS_PROVIDER: "console" })).toThrow(/console/i);
  });

  it("allows fake only outside production and warns loudly", () => {
    const env = loadEnv({ NODE_ENV: "test", PSP_PROVIDER: "fake", SMS_PROVIDER: "console" });
    expect(testProviderWarnings(env)).toHaveLength(2);
  });

  it("still rejects dev secrets and the fake gateway", () => {
    const ok = prod;
    expect(() =>
      loadEnv({ ...ok, JWT_SECRET: "dev-only-secret-change-me-in-production-32+" }),
    ).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...ok, ADMIN_TOKEN: "dev-only-admin-token" })).toThrow(/ADMIN_TOKEN/);
    expect(() => loadEnv({ ...ok, PSP_PROVIDER: "fake" })).toThrow(/fake/);
  });
});

describe("schema guarantees", () => {
  it("rejects a record kind the client must never sync", async () => {
    // `feedback` has its own relational table. If it could enter `records` it
    // would round-trip back to the device and re-dirty forever.
    await h.raw(
      `insert into users (id, phone) values ('11111111-1111-1111-1111-111111111111', '989123334444')`,
    );
    await expect(
      h.raw(
        `insert into records (user_id, kind, id, data, updated_at, seq)
         values ('11111111-1111-1111-1111-111111111111', 'feedback', 'f1', '{}'::jsonb, 1, 1)`,
      ),
    ).rejects.toThrow();
  });

  it("enforces one account per canonical phone", async () => {
    await h.raw(`insert into users (phone) values ('989123334444')`);
    await expect(h.raw(`insert into users (phone) values ('989123334444')`)).rejects.toThrow();
  });

  it("allows only one redemption of a code per user", async () => {
    await h.raw(
      `insert into users (id, phone) values ('22222222-2222-2222-2222-222222222222', '989123334444')`,
    );
    await h.raw(`insert into discounts (code, percent) values ('ROUTINO20', 20)`);
    await h.raw(
      `insert into redemptions (code, user_id) values ('ROUTINO20', '22222222-2222-2222-2222-222222222222')`,
    );
    await expect(
      h.raw(
        `insert into redemptions (code, user_id) values ('ROUTINO20', '22222222-2222-2222-2222-222222222222')`,
      ),
    ).rejects.toThrow();
  });
});
