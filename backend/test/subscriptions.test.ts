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

async function signIn(phone = "09123334444", deviceName?: string) {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code, deviceName },
  });
  return res.json() as { access: string; user: { id: string }; entitlement: { expiresAt: string } };
}

const importSub = (access: string, body: Record<string, unknown>) =>
  h.app.inject({
    method: "POST",
    url: "/v1/subscriptions/import",
    headers: { authorization: `Bearer ${access}` },
    payload: body,
  });

const startTrial = (access: string) =>
  h.app.inject({
    method: "POST",
    url: "/v1/subscriptions/trial/start",
    headers: { authorization: `Bearer ${access}` },
  });

const DAY = 86_400_000;

describe("POST /v1/subscriptions/import", () => {
  it("requires auth", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/subscriptions/import",
      payload: { planId: "m1", expiresAt: Date.now() + DAY },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rescues an existing user's local subscription", async () => {
    // The whole reason this endpoint exists: before the server existed, a user's
    // only proof of a paid plan was their device's localStorage. Without this,
    // flipping the paywall to server entitlement locks out the entire userbase.
    const { access } = await signIn();
    const claimed = Date.now() + 60 * DAY;

    const res = await importSub(access, { planId: "m3", expiresAt: claimed });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      imported: boolean;
      entitlement: { expiresAt: string; planId: string };
    };
    expect(body.imported).toBe(true);
    expect(Date.parse(body.entitlement.expiresAt)).toBe(claimed);
    expect(body.entitlement.planId).toBe("m3");
  });

  it("raises expiry to the claim without adding local time", async () => {
    const { access } = await signIn();
    const claimed = Date.now() + 60 * DAY;
    const body = (await importSub(access, { planId: "m3", expiresAt: claimed })).json() as {
      entitlement: { expiresAt: string };
    };
    expect(Date.parse(body.entitlement.expiresAt)).toBe(claimed);
  });

  it("never lowers an entitlement that is already better", async () => {
    const { access } = await signIn();
    const entitlement = (await startTrial(access)).json().entitlement as { expiresAt: string };
    const claimed = Date.now() + 2 * DAY; // worse than the trial
    const body = (await importSub(access, { planId: "m1", expiresAt: claimed })).json() as {
      imported: boolean;
      entitlement: { expiresAt: string };
    };
    expect(body.entitlement.expiresAt).toBe(entitlement.expiresAt); // untouched
  });

  it("caps an implausible claim instead of trusting it", async () => {
    // The body is client-authored: anyone can POST expiresAt 2099. It cannot be
    // validated, only bounded.
    const { access } = await signIn();
    const res = await importSub(access, { planId: "m12", expiresAt: Date.parse("2099-01-01") });
    const body = res.json() as {
      imported: boolean;
      capped: boolean;
      entitlement: { expiresAt: string };
    };

    expect(body.imported).toBe(true);
    expect(body.capped).toBe(true);
    const grantedDays = (Date.parse(body.entitlement.expiresAt) - Date.now()) / DAY;
    expect(grantedDays).toBeLessThanOrEqual(h.env.IMPORT_MAX_DAYS + 1);
    expect(grantedDays).toBeGreaterThan(h.env.IMPORT_MAX_DAYS - 1);
  });

  it("caps a claim too large for a Date instead of returning a 500", async () => {
    // `z.number().int().positive()` admits values past the largest instant a Date
    // can represent. `new Date()` then yields Invalid Date, and BOTH the
    // already-expired and the over-cap guard miss it because every comparison
    // against NaN is false — so it reached ensureExpiresAt and threw RangeError.
    const { access } = await signIn();
    const res = await importSub(access, { planId: "m12", expiresAt: 9e15 });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      imported: boolean;
      capped: boolean;
      entitlement: { expiresAt: string };
    };
    expect(body.imported).toBe(true);
    expect(body.capped).toBe(true);
    const grantedDays = (Date.parse(body.entitlement.expiresAt) - Date.now()) / DAY;
    expect(grantedDays).toBeLessThanOrEqual(h.env.IMPORT_MAX_DAYS + 1);
  });

  it("cannot be replayed for more time", async () => {
    const { access } = await signIn();
    const first = (
      await importSub(access, { planId: "m3", expiresAt: Date.now() + 60 * DAY })
    ).json() as {
      entitlement: { expiresAt: string };
    };

    const second = (
      await importSub(access, { planId: "m12", expiresAt: Date.now() + 300 * DAY })
    ).json() as {
      imported: boolean;
      reason: string;
      entitlement: { expiresAt: string };
    };
    expect(second.imported).toBe(false);
    expect(second.reason).toBe("already_settled");
    expect(second.entitlement.expiresAt).toBe(first.entitlement.expiresAt);
  });

  it("refuses to import after a real payment", async () => {
    const { access, user } = await signIn();
    await h.raw(`insert into grants (user_id, months, source) values ('${user.id}', 3, 'payment')`);

    const res = (
      await importSub(access, { planId: "m12", expiresAt: Date.now() + 300 * DAY })
    ).json() as {
      imported: boolean;
      reason: string;
    };
    expect(res.imported).toBe(false);
    expect(res.reason).toBe("already_settled");
  });

  it("ignores an already-expired claim", async () => {
    const { access } = await signIn();
    const res = (await importSub(access, { planId: "m1", expiresAt: Date.now() - DAY })).json() as {
      imported: boolean;
      reason: string;
    };
    expect(res.imported).toBe(false);
    expect(res.reason).toBe("already_expired");
  });

  it("records the raw claim for audit", async () => {
    // An implausible import should be visible after the fact.
    const { access, user } = await signIn();
    const claimed = Date.parse("2099-01-01");
    await importSub(access, { planId: "m12", expiresAt: claimed });

    const rows = await h.query<{ source: string; note: string }>(
      `select source, note from grants where user_id = '${user.id}' and source = 'migration'`,
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.note)).toMatchObject({ claimed, capped: true });
  });

  it("rejects a malformed body", async () => {
    const { access } = await signIn();
    expect((await importSub(access, { planId: "m1" })).statusCode).toBe(400);
    expect((await importSub(access, { planId: "m1", expiresAt: -5 })).statusCode).toBe(400);
  });
});

describe("GET /v1/subscriptions/me", () => {
  it("returns the server's entitlement and its own clock", async () => {
    const { access } = await signIn();
    const res = await h.app.inject({
      method: "GET",
      url: "/v1/subscriptions/me",
      headers: { authorization: `Bearer ${access}` },
    });
    const body = res.json() as {
      entitlement: { status: string; planId: string; issuedAt: string };
    };
    expect(body.entitlement.status).toBe("none");
    expect(body.entitlement.planId).toBeNull();
    // issuedAt lets the client detect its own clock skew without trusting it.
    expect(Date.parse(body.entitlement.issuedAt)).toBeGreaterThan(0);
  });
});

describe("POST /v1/subscriptions/trial/start", () => {
  it("requires auth", async () => {
    expect(
      (await h.app.inject({ method: "POST", url: "/v1/subscriptions/trial/start" })).statusCode,
    ).toBe(401);
  });

  it("starts once and returns the same expiry on retry", async () => {
    const { access, user } = await signIn();
    const first = (await startTrial(access)).json() as {
      started: boolean;
      entitlement: { status: string; planId: string; expiresAt: string };
    };
    const second = (await startTrial(access)).json() as typeof first & { reason: string };
    expect(first.started).toBe(true);
    expect(first.entitlement).toMatchObject({ status: "active", planId: "trial" });
    expect((Date.parse(first.entitlement.expiresAt) - Date.now()) / DAY).toBeCloseTo(7, 1);
    expect(second).toMatchObject({ started: false, reason: "previous_grant" });
    expect(second.entitlement.expiresAt).toBe(first.entitlement.expiresAt);
    expect(await h.query(`select id from grants where user_id = '${user.id}'`)).toHaveLength(1);
  });

  it("lets concurrent devices produce only one trial grant", async () => {
    const firstDevice = await signIn("09123334444", "First device");
    await h.raw(`delete from otp_codes`);
    const secondDevice = await signIn("09123334444", "Second device");
    const results = await Promise.all([
      startTrial(firstDevice.access),
      startTrial(secondDevice.access),
    ]);
    const bodies = results.map((response) => response.json()) as Array<{
      started: boolean;
      entitlement: { expiresAt: string };
    }>;
    expect(bodies.filter((body) => body.started)).toHaveLength(1);
    expect(new Set(bodies.map((body) => body.entitlement.expiresAt)).size).toBe(1);
    expect(
      await h.query(`select id from grants where user_id = '${firstDevice.user.id}'`),
    ).toHaveLength(1);
    expect(
      await h.query(`select id from devices where user_id = '${firstDevice.user.id}'`),
    ).toHaveLength(2);
  });
});
