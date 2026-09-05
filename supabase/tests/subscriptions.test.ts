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
  it("returns none after first sign-in", async () => {
    const { access } = await signIn(h);
    const res = await h.call("GET", "/v1/subscriptions/me", { headers: auth(access) });
    const { entitlement } = await res.json();
    expect(entitlement.status).toBe("none");
    expect(entitlement.planId).toBeNull();
  });

  it("repairs a paid checkout when the gateway callback was lost", async () => {
    const { access } = await signIn(h);
    const checkout = await h.call("POST", "/v1/payments/checkout", {
      headers: auth(access),
      body: { planId: "m1", attemptId: crypto.randomUUID() },
    });
    const payment = (await checkout.json()) as { authority: string };
    h.psp._settle(payment.authority, "paid");

    const res = await h.call("GET", "/v1/subscriptions/me", { headers: auth(access) });
    const { entitlement } = await res.json();
    // One plan month is a real calendar month. This runs just after the grant,
    // so a strict `> 30` rejects a correct 30-day month; 27 covers February.
    expect((Date.parse(entitlement.expiresAt) - Date.now()) / DAY).toBeGreaterThan(27);
  });
});

describe("POST /v1/subscriptions/import", () => {
  it("uses a far-future legacy cutoff by default in the Edge harness", () => {
    expect(new Date(h.env.LEGACY_IMPORT_CUTOFF).toISOString()).toBe("2999-01-01T00:00:00.000Z");
  });

  it("raises expiry to the claimed date without adding local time", async () => {
    const { access } = await signIn(h);
    const claimed = Date.now() + 30 * DAY;

    const res = await h.call("POST", "/v1/subscriptions/import", {
      headers: auth(access),
      body: { planId: "m1", expiresAt: claimed },
    });
    const body = await res.json();
    expect(body.imported).toBe(true);
    expect(body.capped).toBe(false);
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
    expect(grants).toHaveLength(0);
  });
});

describe("POST /v1/subscriptions/trial/start", () => {
  it("requires auth", async () => {
    expect((await h.call("POST", "/v1/subscriptions/trial/start")).status).toBe(401);
  });

  it("starts once and cannot be stacked by concurrent requests", async () => {
    const firstSession = await signIn(h, "09123334444");
    await h.raw(`delete from otp_codes`);
    const secondSession = await signIn(h, "09123334444");
    const responses = await Promise.all(
      [firstSession.access, secondSession.access, firstSession.access, secondSession.access].map(
        (access) => h.call("POST", "/v1/subscriptions/trial/start", { headers: auth(access) }),
      ),
    );
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies.filter((body) => body.started)).toHaveLength(1);
    expect(new Set(bodies.map((body) => body.entitlement.expiresAt)).size).toBe(1);
    expect((Date.parse(bodies[0].entitlement.expiresAt) - Date.now()) / DAY).toBeCloseTo(7, 1);
    expect(
      await h.query(`select id from grants where user_id = '${firstSession.user.id}'`),
    ).toHaveLength(1);
  });
});
