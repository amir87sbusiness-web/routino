import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auth, makeHarness, signIn, type Harness } from "./helpers/harness.ts";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

describe("referral routes — Edge adapter", () => {
  it("requires authentication", async () => {
    expect((await h.call("GET", "/v1/referrals/me")).status).toBe(401);
    expect((await h.call("POST", "/v1/referrals/claim", { body: { code: "ABCDEF" } })).status).toBe(
      401,
    );
  });

  it("returns the canonical summary without PII", async () => {
    const user = await signIn(h, "09125550001");
    const response = await h.call("GET", "/v1/referrals/me", { headers: auth(user.access) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      referralCode: expect.stringMatching(/^[A-Z]{6}$/),
      rewardDays: 7,
      successfulInvites: 0,
      earnedDays: 0,
      claimState: { status: "eligible" },
    });
  });

  it("normalizes and idempotently claims an inviter code", async () => {
    const inviter = await signIn(h, "09125550002");
    const invitee = await signIn(h, "09125550003");
    const inviterSummary = await h.call("GET", "/v1/referrals/me", {
      headers: auth(inviter.access),
    });
    const code = ((await inviterSummary.json()) as { referralCode: string }).referralCode;

    for (const submitted of [`  ${code.toLowerCase()}  `, code]) {
      const response = await h.call("POST", "/v1/referrals/claim", {
        headers: auth(invitee.access),
        body: { code: submitted },
      });
      expect(response.status).toBe(200);
      expect((await response.json()).claimState).toEqual({ status: "claimed" });
    }
  });

  it("returns the same validation error contract as Fastify", async () => {
    const user = await signIn(h, "09125550004");
    const response = await h.call("POST", "/v1/referrals/claim", {
      headers: auth(user.access),
      body: { code: "ABC123" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_referral_code" });
  });

  it("maps an overlong string to the referral domain error", async () => {
    const user = await signIn(h, "09125550005");
    const response = await h.call("POST", "/v1/referrals/claim", {
      headers: auth(user.access),
      body: { code: "A".repeat(65) },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_referral_code" });
  });
});
