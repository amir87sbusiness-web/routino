/**
 * Payments that the browser never finished for us.
 *
 * The gateway callback is a REDIRECT of the user's browser. In Iran that browser
 * is routinely behind a VPN or a connection that drops, so "money moved but the
 * callback never landed" must be recoverable without a support ticket.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
const RECONCILE_SECRET = "r".repeat(48);

beforeEach(async () => {
  h ??= await makeHarness({ PAYMENT_RECONCILE_SECRET: RECONCILE_SECRET });
  await h.truncate();
  h.psp._txns.clear();
});
afterAll(async () => {
  await h?.close();
});

const auth = (access: string) => ({ authorization: `Bearer ${access}` });
const reconcileAuth = () => ({ "x-payment-reconcile-secret": RECONCILE_SECRET });

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
    payload: { planId: "m1", attemptId: crypto.randomUUID() },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { paymentId: string; authority: string };
}

async function openApp(access: string) {
  const res = await h.app.inject({
    method: "GET",
    url: "/v1/subscriptions/me",
    headers: auth(access),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { entitlement: { status: string; expiresAt: string | null } };
}

const daysLeft = (iso: string | null) =>
  iso === null ? 0 : Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);

describe("a payment whose callback never came back", () => {
  it("does not Verify a fresh authority during ordinary app opens", async () => {
    const { access } = await signIn("09121110006");
    const { paymentId } = await checkout(access);

    await openApp(access);
    await openApp(access);
    await openApp(access);
    const [payment] = await h.query<{ next_verify_at: string | null }>(`
      select next_verify_at::text from payments where id = '${paymentId}'
    `);
    expect(payment!.next_verify_at).toBeNull();
  });

  it("continues a callback-proven Verify only in scheduled recovery", async () => {
    const { access } = await signIn("09121110007");
    const { paymentId, authority } = await checkout(access);

    const callback = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${paymentId}&Authority=${authority}&Status=OK`,
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.body).toContain(`paymentId=${paymentId}`);
    expect(callback.body).toContain("در حال بررسی");
    h.psp._settle(authority, "paid");
    expect((await openApp(access)).entitlement.status).not.toBe("active");
    await h.raw(
      `update payments set next_verify_at=now()-interval '1 second' where id='${paymentId}'`,
    );
    const recovered = await h.app.inject({
      method: "POST",
      url: "/internal/payments/reconcile",
      headers: reconcileAuth(),
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ recovered: 1 });
    expect((await openApp(access)).entitlement.status).toBe("active");
  });

  it("leaves paid-but-never-called-back recovery to the authoritative feed", async () => {
    const { access } = await signIn("09121110001");
    const { paymentId, authority } = await checkout(access);
    h.psp._settle(authority, "paid");

    const before = await openApp(access);
    const after = await openApp(access);

    expect(after.entitlement.status).not.toBe("active");
    expect(before.entitlement.status).not.toBe("active");
    const [payment] = await h.query<{ status: string }>(`
      select status from payments where id='${paymentId}'
    `);
    expect(payment).toMatchObject({ status: "redirected" });
  });

  it("does not grant when the user actually cancelled", async () => {
    const { access } = await signIn("09121110002");
    const { authority } = await checkout(access);
    h.psp._settle(authority, "canceled");

    const after = await openApp(access);
    expect(daysLeft(after.entitlement.expiresAt)).toBeLessThan(10);
  });

  it("does not grant for a payment that never reached the gateway", async () => {
    const { access } = await signIn("09121110003");
    await checkout(access);

    const after = await openApp(access);
    expect(daysLeft(after.entitlement.expiresAt)).toBeLessThan(10);
  });

  it("grants exactly once however many times the app is opened", async () => {
    const { access } = await signIn("09121110004");
    const { paymentId, authority } = await checkout(access);
    h.psp._settle(authority, "paid");

    await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${paymentId}&Authority=${authority}&Status=OK`,
    });

    await openApp(access);
    const once = await openApp(access);
    await openApp(access);
    const thrice = await openApp(access);

    expect(thrice.entitlement.expiresAt).toBe(once.entitlement.expiresAt);
  });

  it("still settles when the callback arrives later as well", async () => {
    const { access } = await signIn("09121110005");
    const { paymentId, authority } = await checkout(access);
    h.psp._settle(authority, "paid");

    const before = await openApp(access);
    expect(before.entitlement.status).not.toBe("active");

    await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${paymentId}&Authority=${authority}&Status=OK`,
    });

    const after = await openApp(access);
    expect(after.entitlement.status).toBe("active");
    expect(daysLeft(after.entitlement.expiresAt)).toBeGreaterThan(27);
  });

  it.each([-55])(
    "keeps provider code %i recoverable through the 30-minute gateway window, then reviews it without losing authoritative recovery",
    async (providerCode) => {
      const { access } = await signIn("09121110010");
      const { paymentId, authority } = await checkout(access);
      // At 30 minutes the provider checkout can still be valid. Do not call the
      // transaction failed just because Verify is still returning an ambiguous
      // -51/-55 response.
      await h.raw(`
        update payments
           set status='verifying', psp_result=${providerCode},
               created_at=now()-interval '30 minutes',
               verify_started_at=null, next_verify_at=now()-interval '1 second'
         where id='${paymentId}'
      `);
      const withinProviderWindow = await h.app.inject({
        method: "POST",
        url: "/internal/payments/reconcile",
        headers: reconcileAuth(),
      });
      expect(withinProviderWindow.statusCode).toBe(200);
      expect(withinProviderWindow.json()).toMatchObject({
        success: true,
        recovered: 0,
        reviewed: 0,
      });
      let [payment] = await h.query<{ status: string }>(`
        select status from payments where id='${paymentId}'
      `);
      expect(payment?.status).not.toBe("failed");
      expect(payment?.status).not.toBe("manual_review");

      // Once the 30-minute provider lifetime plus five minutes of headroom has
      // elapsed, stop blind Verify retries. This is still not proof of failure.
      await h.raw(`
        update payments
           set status='verifying', psp_result=${providerCode},
               created_at=now()-interval '36 minutes',
               verify_started_at=null, next_verify_at=now()-interval '1 second'
         where id='${paymentId}'
      `);
      const bounded = await h.app.inject({
        method: "POST",
        url: "/internal/payments/reconcile",
        headers: reconcileAuth(),
      });
      expect(bounded.statusCode).toBe(200);
      expect(bounded.json()).toMatchObject({ success: true, reviewed: 1 });
      [payment] = await h.query<{ status: string }>(`
        select status from payments where id='${paymentId}'
      `);
      expect(payment?.status).toBe("manual_review");

      await openApp(access);
      const [afterPoll] = await h.query<{ status: string }>(`
        select status from payments where id='${paymentId}'
      `);
      expect(afterPoll?.status).toBe("manual_review");

      // `manual_review` is not a dead end: the PSP's authoritative paid-but-
      // unverified feed can reopen it, and normal 100/101 Verify is still the
      // only path that grants entitlement.
      h.psp._settle(authority, "paid");
      const recovered = await h.app.inject({
        method: "POST",
        url: "/internal/payments/reconcile",
        headers: reconcileAuth(),
      });
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json()).toMatchObject({
        success: true,
        discovered: 1,
        matched: 1,
        checked: 1,
        recovered: 1,
      });
      expect((await openApp(access)).entitlement.status).toBe("active");
    },
  );

  it("uses ZarinPal unVerified discovery to recover paid money without a callback", async () => {
    const { access } = await signIn("09121110009");
    const { paymentId, authority } = await checkout(access);
    h.psp._settle(authority, "paid");
    const reconcile = await h.app.inject({
      method: "POST",
      url: "/internal/payments/reconcile",
      headers: reconcileAuth(),
    });
    expect(reconcile.statusCode).toBe(200);
    expect(reconcile.json()).toMatchObject({
      success: true,
      mode: "authoritative",
      discovered: 1,
      matched: 1,
      checked: 1,
      recovered: 1,
    });
    expect((await openApp(access)).entitlement.status).toBe("active");

    const [grantCount] = await h.query<{ count: number }>(`
      select count(*)::int as count from grants where payment_id='${paymentId}'
    `);
    expect(Number(grantCount?.count)).toBe(1);
  });

  it("uses Inquiry to recover a stale paid authority missing from unVerified", async () => {
    const { access } = await signIn("09121110014");
    const { paymentId, authority } = await checkout(access);
    h.psp._settle(authority, "paid");
    const originalList = h.psp.listUnverified;
    h.psp.listUnverified = async () => ({ kind: "ok", items: [] });
    await h.raw(
      `update payments set created_at=now()-interval '36 minutes' where id='${paymentId}'`,
    );

    const reconcile = await h.app.inject({
      method: "POST",
      url: "/internal/payments/reconcile",
      headers: reconcileAuth(),
    });

    h.psp.listUnverified = originalList;
    expect(reconcile.statusCode).toBe(200);
    expect(reconcile.json()).toMatchObject({ discovered: 0, checked: 1, recovered: 1 });
    expect((await openApp(access)).entitlement.status).toBe("active");
  });

  it("does not start a second Verify while an authoritative recovery lease is active", async () => {
    const { access } = await signIn("09121110013");
    const { authority } = await checkout(access);
    h.psp._settle(authority, "paid");
    const originalVerify = h.psp.verify.bind(h.psp);
    let verifyCalls = 0;
    let releaseFirst!: () => void;
    const firstVerifyStarted = new Promise<void>((resolve) => {
      h.psp.verify = async (...args) => {
        verifyCalls += 1;
        if (verifyCalls === 1) {
          resolve();
          await new Promise<void>((release) => {
            releaseFirst = release;
          });
        }
        return originalVerify(...args);
      };
    });

    const first = h.app.inject({
      method: "POST",
      url: "/internal/payments/reconcile-unverified",
      headers: reconcileAuth(),
    });
    await firstVerifyStarted;
    const second = h.app.inject({
      method: "POST",
      url: "/internal/payments/reconcile-unverified",
      headers: reconcileAuth(),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const callsWhileFirstWasActive = verifyCalls;
    releaseFirst();
    await Promise.all([first, second]);

    expect(callsWhileFirstWasActive).toBe(1);
    expect(verifyCalls).toBe(1);
  });

  it("never trusts an unVerified authority whose amount differs from our stored price", async () => {
    const { access } = await signIn("09121110011");
    const { paymentId, authority } = await checkout(access);
    h.psp._settle(authority, "paid");
    const [stored] = await h.query<{ amount_rial: number }>(`
      select amount_rial from payments where id='${paymentId}'
    `);

    const originalList = h.psp.listUnverified;
    h.psp.listUnverified = async () => ({
      kind: "ok",
      items: [{ authority, amountRial: Number(stored!.amount_rial) + 10 }],
    });
    const reconcile = await h.app.inject({
      method: "POST",
      url: "/internal/payments/reconcile-unverified",
      headers: reconcileAuth(),
    });
    expect(reconcile.statusCode).toBe(200);
    expect(reconcile.json()).toMatchObject({ checked: 0, recovered: 0, skipped: 1 });

    const [payment] = await h.query<{ applied_at: string | null }>(`
      select applied_at::text from payments where id='${paymentId}'
    `);
    const [grantCount] = await h.query<{ count: number }>(`
      select count(*)::int as count from grants where payment_id='${paymentId}'
    `);
    expect(payment?.applied_at).toBeNull();
    expect(Number(grantCount?.count)).toBe(0);
    h.psp.listUnverified = originalList;
  });

  it("surfaces an unavailable unVerified provider as a non-2xx cron failure", async () => {
    await signIn("09121110012");
    h.psp.listUnverified = async () => ({ kind: "unknown", code: -9 });
    const reconcile = await h.app.inject({
      method: "POST",
      url: "/internal/payments/reconcile-unverified",
      headers: reconcileAuth(),
    });
    expect(reconcile.statusCode).toBe(502);
    expect(reconcile.json()).toMatchObject({
      success: false,
      error: "provider_unverified_unavailable",
      providerCode: -9,
    });
  });
});
