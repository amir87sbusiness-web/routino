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

const admin = { "x-admin-token": "dev-only-admin-token" };

async function signIn(phone = "09123334444") {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  return res.json() as { access: string; refresh: string; user: { id: string } };
}

describe("admin auth", () => {
  it("throttles repeated wrong tokens", async () => {
    // Regression: nothing in the stack rate-limited anything, so a loop could
    // guess admin tokens forever at full speed — and this token gifts
    // subscriptions and resets passwords. The counter lives in Postgres because
    // production runs on serverless isolates, where an in-memory Map resets on
    // every cold start.
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await h.app.inject({
        method: "GET",
        url: "/v1/admin/overview",
        headers: { "x-admin-token": `guess-${i}` },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 9)).toEqual(Array(9).fill(401));
    expect(codes.slice(9)).toEqual(Array(3).fill(429));

    // The lockout is on guessing, not on the panel: the real token still works
    // from the same IP, so nobody can lock the owner out of their own panel.
    expect(
      (await h.app.inject({ method: "GET", url: "/v1/admin/overview", headers: admin })).statusCode,
    ).toBe(200);
  });

  it("rejects a missing or wrong token", async () => {
    expect((await h.app.inject({ method: "GET", url: "/v1/admin/overview" })).statusCode).toBe(401);
    expect(
      (
        await h.app.inject({
          method: "GET",
          url: "/v1/admin/overview",
          headers: { "x-admin-token": "guess" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("serves the panel shell without auth but with no data in it", async () => {
    const res = await h.app.inject({ method: "GET", url: "/admin" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("پنل مدیریت");
  });
});

describe("admin endpoints", () => {
  it("overview counts users, subscriptions and revenue", async () => {
    const { user, access } = await signIn();
    const checkout = (
      await h.app.inject({
        method: "POST",
        url: "/v1/payments/checkout",
        headers: { authorization: `Bearer ${access}` },
        payload: { planId: "m3", attemptId: crypto.randomUUID() },
      })
    ).json() as { trackId: number; paymentId: string };
    await h.app.inject({
      method: "GET",
      url: `/v1/dev/gateway/settle?trackId=${checkout.trackId}&outcome=paid`,
    });
    // `orderId` is required: every real gateway echoes it back, and the callback
    // ignores a caller that cannot prove it knows more than the guessable trackId.
    await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?trackId=${checkout.trackId}&success=1&status=2&orderId=${checkout.paymentId}`,
    });

    const res = await h.app.inject({ method: "GET", url: "/v1/admin/overview", headers: admin });
    const body = res.json();
    expect(body.users.total).toBe(1);
    expect(body.activeSubscriptions).toBe(1);
    expect(body.payments.paidTotal).toBe(1);
    expect(body.payments.revenueToman).toBe(149000);
    expect(user.id).toBeTruthy();
  });

  it("finds users by partial phone and reports their entitlement", async () => {
    await signIn("09123334444");
    await signIn("09351112222");
    const res = await h.app.inject({
      method: "GET",
      url: "/v1/admin/users?q=0912",
      headers: admin,
    });
    const { users } = res.json() as { users: { phone: string; subscriptionActive: boolean }[] };
    expect(users).toHaveLength(1);
    expect(users[0]!.phone).toBe("989123334444");
    expect(users[0]!.subscriptionActive).toBe(false); // pre-activation account
  });

  it("blocking a user revokes every session immediately", async () => {
    const { user, access, refresh } = await signIn();

    const res = await h.app.inject({
      method: "POST",
      url: `/v1/admin/users/${user.id}/block`,
      headers: admin,
      payload: { blocked: true },
    });
    expect(res.json().ok).toBe(true);

    // Access token dies at the auth plugin (fresh user-row read)…
    const me = await h.app.inject({
      method: "GET",
      url: "/v1/subscriptions/me",
      headers: { authorization: `Bearer ${access}` },
    });
    expect(me.statusCode).toBe(403);
    // …and the refresh token was revoked, so no new session can be minted.
    const rotated = await h.app.inject({
      method: "POST",
      url: "/v1/auth/token/refresh",
      payload: { refresh },
    });
    expect(rotated.statusCode).toBe(401);
  });

  it("manual grant extends entitlement and lands in the ledger", async () => {
    const { user } = await signIn();
    const res = await h.app.inject({
      method: "POST",
      url: `/v1/admin/users/${user.id}/grant`,
      headers: admin,
      payload: { months: 1, note: "support gesture" },
    });
    expect(res.json().entitlement.status).toBe("active");

    const rows = await h.query<{ source: string; note: string }>(
      `select source, note from grants where user_id = '${user.id}' and source = 'admin'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toBe("support gesture");
  });

  it("does not expose obsolete device quota administration", async () => {
    const { user } = await signIn();
    const response = await h.app.inject({
      method: "POST",
      url: `/v1/admin/users/${user.id}/device-policy`,
      headers: admin,
      payload: { maxActiveDevices: 3 },
    });
    expect(response.statusCode).toBe(404);
  });

  it("creates, lists and deactivates discounts", async () => {
    const created = await h.app.inject({
      method: "POST",
      url: "/v1/admin/discounts",
      headers: admin,
      payload: { code: "eid1405", percent: 30, maxUses: 100 },
    });
    expect(created.json().discount.code).toBe("EID1405"); // normalised

    const dup = await h.app.inject({
      method: "POST",
      url: "/v1/admin/discounts",
      headers: admin,
      payload: { code: "EID1405", percent: 10 },
    });
    expect(dup.statusCode).toBe(400);

    const off = await h.app.inject({
      method: "POST",
      url: "/v1/admin/discounts/EID1405",
      headers: admin,
      payload: { active: false },
    });
    expect(off.json().discount.active).toBe(false);

    const list = await h.app.inject({ method: "GET", url: "/v1/admin/discounts", headers: admin });
    expect(list.json().discounts).toHaveLength(1);
  });
});
