/** Legacy-subscription import bounds + entitlement reads — edge app. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth, makeHarness, signIn, type Harness } from "./helpers/harness.ts";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  h.psp._txns.clear();
});
afterAll(async () => {
  await h?.close();
});

const DAY = 86_400_000;

describe("GET /v1/subscriptions/me", () => {
  it("returns the trial entitlement after first sign-in", async () => {
    const { access } = await signIn(h);
    const res = await h.call("GET", "/v1/subscriptions/me", { headers: auth(access) });
    const { entitlement } = await res.json();
    expect(entitlement.status).toBe("active");
    expect(entitlement.planId).toBe("trial");
  });

  it("repairs a paid checkout when the gateway callback was lost", async () => {
    const { access } = await signIn(h);
    const checkout = await h.call("POST", "/v1/payments/checkout", {
      headers: auth(access),
      body: { planId: "m1" },
    });
    const payment = (await checkout.json()) as { trackId: number };
    h.psp._settle(payment.trackId, "paid");

    const res = await h.call("GET", "/v1/subscriptions/me", { headers: auth(access) });
    const { entitlement } = await res.json();
    expect((Date.parse(entitlement.expiresAt) - Date.now()) / DAY).toBeGreaterThan(30);
  });
});

describe("POST /v1/subscriptions/import", () => {
  it("raises expiry to the claimed date (no stacking on the trial)", async () => {
    const { access } = await signIn(h);
    const claimed = Date.now() + 30 * DAY;

    const res = await h.call("POST", "/v1/subscriptions/import", {
      headers: auth(access),
      body: { planId: "m1", expiresAt: claimed },
    });
    const body = await res.json();
    expect(body.imported).toBe(true);
    expect(body.capped).toBe(false);
    // max(current, claimed), not trial + 30 days.
    expect(Math.abs(Date.parse(body.entitlement.expiresAt) - claimed)).toBeLessThan(1000);
  });

  it("caps an implausible claim at IMPORT_MAX_DAYS", async () => {
    const { access } = await signIn(h);
    const res = await h.call("POST", "/v1/subscriptions/import", {
      headers: auth(access),
      body: { planId: "m12", expiresAt: Date.now() + 5000 * DAY },
    });
    const body = await res.json();
    expect(body.imported).toBe(true);
    expect(body.capped).toBe(true);
    const days = (Date.parse(body.entitlement.expiresAt) - Date.now()) / DAY;
    expect(days).toBeLessThanOrEqual(h.env.IMPORT_MAX_DAYS + 1);
  });

  it("caps a claim too large for a Date instead of returning a 500", async () => {
    // Zod admits values past the largest instant a Date can represent; the
    // resulting Invalid Date slips BOTH guards (every NaN comparison is false)
    // and used to throw RangeError inside ensureExpiresAt. routes/ is
    // hand-mirrored from Fastify, so this needs its own edge coverage.
    const { access } = await signIn(h);
    const res = await h.call("POST", "/v1/subscriptions/import", {
      headers: auth(access),
      body: { planId: "m12", expiresAt: 9e15 },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(true);
    expect(body.capped).toBe(true);
    const days = (Date.parse(body.entitlement.expiresAt) - Date.now()) / DAY;
    expect(days).toBeLessThanOrEqual(h.env.IMPORT_MAX_DAYS + 1);
  });

  it("is once-per-account: a second import cannot extend again", async () => {
    const { access } = await signIn(h);
    await h.call("POST", "/v1/subscriptions/import", {
      headers: auth(access),
      body: { planId: "m1", expiresAt: Date.now() + 30 * DAY },
    });
    const replay = await h.call("POST", "/v1/subscriptions/import", {
      headers: auth(access),
      body: { planId: "m12", expiresAt: Date.now() + 300 * DAY },
    });
    const body = await replay.json();
    expect(body.imported).toBe(false);
    expect(body.reason).toBe("already_settled");
  });

  it("ignores an already-expired claim", async () => {
    const { access } = await signIn(h);
    const res = await h.call("POST", "/v1/subscriptions/import", {
      headers: auth(access),
      body: { planId: "m1", expiresAt: Date.now() - DAY },
    });
    const body = await res.json();
    expect(body.imported).toBe(false);
    expect(body.reason).toBe("already_expired");
  });
});

describe("GET /v1/subscriptions/grants", () => {
  it("lists the ledger for support", async () => {
    const { access } = await signIn(h);
    const res = await h.call("GET", "/v1/subscriptions/grants", { headers: auth(access) });
    const { grants } = await res.json();
    expect(grants).toHaveLength(1);
    expect(grants[0].source).toBe("trial");
  });
});
