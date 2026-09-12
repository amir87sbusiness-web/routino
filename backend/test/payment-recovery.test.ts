/**
 * Payments that the browser never finished for us.
 *
 * The gateway callback is a REDIRECT of the user's browser. In Iran that browser
 * is routinely behind a VPN or a connection that drops, so "money moved but the
 * callback never landed" must be recoverable without a support ticket.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
const RECONCILE_SECRET = "r".repeat(48);

beforeEach(async () => {
  h ??= await makeHarness({ PAYMENT_RECONCILE_SECRET: RECONCILE_SECRET });
  await h.truncate();
  h.psp._txns.clear();
});
afterEach(() => vi.unstubAllGlobals());
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

function stubUnverified(
  authorities: Array<{ authority: string; amount: number | string }>,
  options: { status?: number; errorCode?: number } = {},
) {
  const status = options.status ?? 200;
  const body =
    options.errorCode === undefined
      ? { data: { code: 100, authorities }, errors: [] }
      : { data: [], errors: { code: options.errorCode, message: "provider error" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

const daysLeft = (iso: string | null) =>
  iso === null ? 0 : Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);

describe("a payment whose callback never came back", () => {
  it("coalesces rapid recovery polls and retries only after the stored cooldown", async () => {
    const { access } = await signIn("09121110006");
    const { paymentId } = await checkout(access);

    await openApp(access);
    await openApp(access);
    await openApp(access);
    let [payment] = await h.query<{ verify_attempts: number; next_verify_at: string }>(`
      select verify_attempts, next_verify_at::text from payments where id = '${paymentId}'
    `);
    expect(Number(payment!.verify_attempts)).toBe(1);
    expect(new Date(payment!.next_verify_at).getTime()).toBeGreaterThan(Date.now());

    await h.raw(
      `update payments set next_verify_at = now() - interval '1 second' where id = '${paymentId}'`,
    );
    await openApp(access);
    [payment] = await h.query<{ verify_attempts: number; next_verify_at: string }>(`
      select verify_attempts, next_verify_at::text from payments where id = '${paymentId}'
    `);
    expect(Number(payment!.verify_attempts)).toBe(2);
  });

  it("keeps the callback recoverable while respecting a poll cooldown", async () => {
    const { access } = await signIn("09121110007");
    const { paymentId, authority } = await checkout(access);
    await openApp(access);
    h.psp._settle(authority, "paid");

    const callback = await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${paymentId}&Authority=${authority}&Status=OK`,
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.body).toContain(`paymentId=${paymentId}`);
    expect(callback.body).toContain("در حال بررسی");
    expect((await openApp(access)).entitlement.status).not.toBe("active");
    await h.raw(
      `update payments set next_verify_at=now()-interval '1 second' where id='${paymentId}'`,
    );
    expect((await openApp(access)).entitlement.status).toBe("active");
  });

  it("is finished the next time the user opens the app", async () => {
    const { access } = await signIn("09121110001");
    const { authority } = await checkout(access);
    h.psp._settle(authority, "paid");

    const before = await openApp(access);
    const after = await openApp(access);

    expect(after.entitlement.status).toBe("active");
    expect(daysLeft(after.entitlement.expiresAt)).toBeGreaterThan(27);
    expect(daysLeft(before.entitlement.expiresAt)).toBeGreaterThan(27);
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
    const { authority } = await checkout(access);
    h.psp._settle(authority, "paid");

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

    const healed = await openApp(access);
    expect(healed.entitlement.status).toBe("active");

    await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${paymentId}&Authority=${authority}&Status=OK`,
    });

    const after = await openApp(access);
    expect(daysLeft(after.entitlement.expiresAt)).toBe(daysLeft(healed.entitlement.expiresAt));
  });

  it.each([-51, -55])(
    "bounds stale provider code %i but still recovers it from authoritative unVerified",
    async (providerCode) => {
      const { access } = await signIn(providerCode === -51 ? "09121110008" : "09121110010");
      const { paymentId, authority } = await checkout(access);
      const [stored] = await h.query<{ amount_rial: number }>(`
        select amount_rial from payments where id='${paymentId}'
      `);
      await h.raw(`
        update payments
           set status='verifying', psp_result=${providerCode},
               created_at=now()-interval '30 minutes',
               verify_started_at=null, next_verify_at=now()-interval '1 second'
         where id='${paymentId}'
      `);

      const bounded = await h.app.inject({
        method: "POST",
        url: "/internal/payments/reconcile",
        headers: reconcileAuth(),
      });
      expect(bounded.statusCode).toBe(200);
      expect(bounded.json()).toMatchObject({ success: true, finalized: 1 });
      const [failed] = await h.query<{ status: string }>(`
        select status from payments where id='${paymentId}'
      `);
      expect(failed?.status).toBe("failed");

      h.psp._settle(authority, "paid");
      stubUnverified([{ authority, amount: Number(stored!.amount_rial) }]);
      const recovered = await h.app.inject({
        method: "POST",
        url: "/internal/payments/reconcile-unverified",
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
    const [stored] = await h.query<{ amount_rial: number }>(`
      select amount_rial from payments where id='${paymentId}'
    `);

    // Accept a numeric string too: provider JSON clients are not always
    // consistent about preserving large integer fields as numbers.
    stubUnverified([{ authority, amount: String(stored!.amount_rial) }]);
    const reconcile = await h.app.inject({
      method: "POST",
      url: "/internal/payments/reconcile-unverified",
      headers: reconcileAuth(),
    });
    expect(reconcile.statusCode).toBe(200);
    expect(reconcile.json()).toMatchObject({
      success: true,
      mode: "unverified",
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

  it("never trusts an unVerified authority whose amount differs from our stored price", async () => {
    const { access } = await signIn("09121110011");
    const { paymentId, authority } = await checkout(access);
    h.psp._settle(authority, "paid");
    const [stored] = await h.query<{ amount_rial: number }>(`
      select amount_rial from payments where id='${paymentId}'
    `);

    stubUnverified([{ authority, amount: Number(stored!.amount_rial) + 10 }]);
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
  });

  it("surfaces an unavailable unVerified provider as a non-2xx cron failure", async () => {
    await signIn("09121110012");
    stubUnverified([], { status: 503, errorCode: -9 });

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
