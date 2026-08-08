/**
 * Payments that the browser never finished for us.
 *
 * The gateway callback is a REDIRECT of the user's browser. In Iran that browser
 * is routinely behind a VPN or a connection that drops, so "money moved but the
 * callback never landed" is an ordinary Tuesday, not an edge case. Every test
 * here is a way that can happen, and the requirement is the same each time: the
 * user ends up subscribed without anyone noticing a support ticket.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  h.psp._txns.clear();
});
afterAll(async () => {
  await h?.close();
});

const auth = (access: string) => ({ authorization: `Bearer ${access}` });

async function signIn(phone: string) {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  return res.json() as { access: string; user: { id: string } };
}

async function checkout(access: string) {
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/payments/checkout",
    headers: auth(access),
    payload: { planId: "m1" },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { paymentId: string; trackId: number };
}

/** Opening the app: the one request every launch makes. */
async function openApp(access: string) {
  const res = await h.app.inject({
    method: "GET",
    url: "/v1/sync/pull?cursor=0",
    headers: auth(access),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { entitlement: { status: string; expiresAt: string | null } };
}

const daysLeft = (iso: string | null) =>
  iso === null ? 0 : Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);

describe("a payment whose callback never came back", () => {
  it("is finished the next time the user opens the app", async () => {
    const { access } = await signIn("09121110001");
    const { trackId } = await checkout(access);

    // The bank took the money and the gateway settled...
    h.psp._settle(trackId, "paid");
    // ...but the redirect never reached us: no callback is invoked at all.

    const before = await openApp(access);
    // (that open IS the recovery — assert on the state it left behind)
    const after = await openApp(access);

    expect(after.entitlement.status).toBe("active");
    expect(daysLeft(after.entitlement.expiresAt)).toBeGreaterThan(30);
    expect(daysLeft(before.entitlement.expiresAt)).toBeGreaterThan(30);
  });

  it("does not grant when the user actually cancelled", async () => {
    const { access } = await signIn("09121110002");
    const { trackId } = await checkout(access);
    h.psp._settle(trackId, "canceled");

    const after = await openApp(access);

    // Still on the 7-day trial, not a month.
    expect(daysLeft(after.entitlement.expiresAt)).toBeLessThan(10);
  });

  it("does not grant for a payment that never reached the gateway", async () => {
    const { access } = await signIn("09121110003");
    await checkout(access); // no settle at all

    const after = await openApp(access);
    expect(daysLeft(after.entitlement.expiresAt)).toBeLessThan(10);
  });

  it("grants exactly once however many times the app is opened", async () => {
    const { access } = await signIn("09121110004");
    const { trackId } = await checkout(access);
    h.psp._settle(trackId, "paid");

    await openApp(access);
    const once = await openApp(access);
    await openApp(access);
    const thrice = await openApp(access);

    expect(thrice.entitlement.expiresAt).toBe(once.entitlement.expiresAt);
  });

  it("still settles when the callback arrives later as well", async () => {
    const { access } = await signIn("09121110005");
    const { paymentId, trackId } = await checkout(access);
    h.psp._settle(trackId, "paid");

    // Recovered on app open first...
    const healed = await openApp(access);
    expect(healed.entitlement.status).toBe("active");

    // ...and then the user's phone finally delivers the redirect it was holding.
    await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?trackId=${trackId}&success=1&status=2&orderId=${paymentId}`,
    });

    const after = await openApp(access);
    expect(daysLeft(after.entitlement.expiresAt)).toBe(daysLeft(healed.entitlement.expiresAt));
  });

  it("repairs a payment that was claimed but whose grant never landed", async () => {
    const { access, user } = await signIn("09121110006");
    const { paymentId, trackId } = await checkout(access);
    h.psp._settle(trackId, "paid");
    await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?trackId=${trackId}&success=1&status=2&orderId=${paymentId}`,
    });

    // Simulate the one window `applyPaid` cannot close by itself: it claims the
    // row and THEN grants, so a process killed between the two leaves a payment
    // marked paid with nothing behind it.
    await h.raw(`delete from grants where payment_id = '${paymentId}'`);
    await h.raw(`delete from entitlements where user_id = '${user.id}'`);

    const after = await openApp(access);

    expect(after.entitlement.status).toBe("active");
    expect(daysLeft(after.entitlement.expiresAt)).toBeGreaterThan(25);
  });
});
