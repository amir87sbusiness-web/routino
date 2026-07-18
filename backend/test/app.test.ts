import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

describe("schema guarantees", () => {
  it("rejects a record kind the client must never sync", async () => {
    // `feedback` has its own relational table. If it could enter `records` it
    // would round-trip back to the device and re-dirty forever.
    await h.raw(`insert into users (id, phone) values ('11111111-1111-1111-1111-111111111111', '989123334444')`);
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
    await h.raw(`insert into users (id, phone) values ('22222222-2222-2222-2222-222222222222', '989123334444')`);
    await h.raw(`insert into discounts (code, percent) values ('ROUTINO20', 20)`);
    await h.raw(
      `insert into redemptions (code, user_id) values ('ROUTINO20', '22222222-2222-2222-2222-222222222222')`,
    );
    await expect(
      h.raw(`insert into redemptions (code, user_id) values ('ROUTINO20', '22222222-2222-2222-2222-222222222222')`),
    ).rejects.toThrow();
  });
});
