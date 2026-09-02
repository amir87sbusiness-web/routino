import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSignIn, makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
let admin: Record<string, string>;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  admin = await adminSignIn(h);
});
afterAll(async () => {
  await h?.close();
});
afterEach(() => vi.restoreAllMocks());

async function signIn(phone = "09123334444") {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  return res.json() as { access: string; user: { id: string } };
}

describe("admin auth", () => {
  it("rejects a missing session and the retired shared-secret header", async () => {
    expect((await h.app.inject({ method: "GET", url: "/v1/admin/overview" })).statusCode).toBe(401);
    expect(
      (
        await h.app.inject({
          method: "GET",
          url: "/v1/admin/overview",
          headers: { "x-admin-token": "retired" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await h.app.inject({ method: "GET", url: "/v1/admin/overview", headers: admin })).statusCode,
    ).toBe(200);
  });

  it("serves the panel shell without auth but with no data in it", async () => {
    const res = await h.app.inject({ method: "GET", url: "/admin" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("پنل مدیریت");
  });
});

describe("admin endpoints", () => {
  it("shows only the anonymous trial-start count, not trial-only account details", async () => {
    const { user, access } = await signIn("09124445566");

    const first = await h.app.inject({
      method: "POST",
      url: "/v1/subscriptions/trial/start",
      headers: { authorization: `Bearer ${access}` },
    });
    const retry = await h.app.inject({
      method: "POST",
      url: "/v1/subscriptions/trial/start",
      headers: { authorization: `Bearer ${access}` },
    });
    expect(first.json().started).toBe(true);
    expect(retry.json().started).toBe(false);

    const overview = await h.app.inject({
      method: "GET",
      url: "/v1/admin/overview",
      headers: admin,
    });
    expect(overview.json().trialStarts).toBe(1);
    expect(overview.json().activeSubscriptions).toBe(0);

    const list = await h.app.inject({
      method: "GET",
      url: "/v1/admin/users?q=09124445566",
      headers: admin,
    });
    expect(list.json().users).toEqual([]);

    const detail = await h.app.inject({
      method: "GET",
      url: `/v1/admin/users/${user.id}`,
      headers: admin,
    });
    expect(detail.statusCode).toBe(404);
  });

  it("overview counts users, subscriptions and revenue", async () => {
    const { user, access } = await signIn();
    const checkout = (
      await h.app.inject({
        method: "POST",
        url: "/v1/payments/checkout",
        headers: { authorization: `Bearer ${access}` },
        payload: { planId: "m3", attemptId: crypto.randomUUID() },
      })
    ).json() as { authority: string; paymentId: string };
    await h.app.inject({
      method: "GET",
      url: `/v1/dev/gateway/settle?Authority=${checkout.authority}&outcome=paid`,
    });
    // `orderId` is required: every real gateway echoes it back, and the callback
    // ignores a caller that cannot prove it knows more than the guessable authority.
    await h.app.inject({
      method: "GET",
      url: `/v1/payments/callback?paymentId=${checkout.paymentId}&Authority=${checkout.authority}&Status=OK`,
    });

    const execute = vi.spyOn(h.db, "execute");
    const res = await h.app.inject({ method: "GET", url: "/v1/admin/overview", headers: admin });
    const body = res.json();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(body.users.total).toBe(1);
    expect(body.activeSubscriptions).toBe(1);
    expect(body.payments.paidTotal).toBe(1);
    expect(body.payments.revenueToman).toBe(149000);
    expect(user.id).toBeTruthy();
  });

  it("hides registration-only users from phone search", async () => {
    await signIn("09123334444");
    await signIn("09351112222");
    const res = await h.app.inject({
      method: "GET",
      url: "/v1/admin/users?q=0912",
      headers: admin,
    });
    const { users } = res.json() as { users: { phone: string; subscriptionActive: boolean }[] };
    expect(users).toEqual([]);
  });

  it("does not expose account blocking", async () => {
    const { user, access } = await signIn();

    const res = await h.app.inject({
      method: "POST",
      url: `/v1/admin/users/${user.id}/block`,
      headers: admin,
      payload: { blocked: true },
    });
    expect(res.statusCode).toBe(404);
    const me = await h.app.inject({
      method: "GET",
      url: "/v1/subscriptions/me",
      headers: { authorization: `Bearer ${access}` },
    });
    expect(me.statusCode).toBe(200);
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
