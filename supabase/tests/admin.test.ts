/** Admin API on the edge app: token guard, grants, block-revokes-sessions,
 * discounts. Mirrors the critical assertions of backend/test/admin.test.ts. */
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

const admin = () => ({ "x-admin-token": h.env.ADMIN_TOKEN });

describe("admin auth", () => {
  it("rejects a missing or wrong token", async () => {
    expect((await h.call("GET", "/v1/admin/overview")).status).toBe(401);
    expect(
      (await h.call("GET", "/v1/admin/overview", { headers: { "x-admin-token": "nope" } })).status,
    ).toBe(401);
  });

  it("serves the panel shell publicly (reveals nothing without a token)", async () => {
    const res = await h.call("GET", "/admin");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("پنل مدیریت");
  });
});

describe("overview + users", () => {
  it("counts users and finds them by local-format phone search", async () => {
    await signIn(h, "09123334444");
    await signIn(h, "09351112222");

    const ov = await (await h.call("GET", "/v1/admin/overview", { headers: admin() })).json();
    expect(ov.users.total).toBe(2);

    const found = await (
      await h.call("GET", "/v1/admin/users?q=0912333", { headers: admin() })
    ).json();
    expect(found.users).toHaveLength(1);
    expect(found.users[0].phone).toBe("989123334444");
  });
});

describe("manual grant", () => {
  it("extends entitlement and writes an auditable ledger row", async () => {
    const { user, entitlement } = await signIn(h);
    const res = await h.call("POST", `/v1/admin/users/${user.id}/grant`, {
      headers: admin(),
      body: { months: 1, note: "support gift" },
    });
    expect(res.status).toBe(200);
    const after = Date.parse((await res.json()).entitlement.expiresAt);
    expect(after).toBeGreaterThan(Date.parse(entitlement.expiresAt) + 27 * 86_400_000);

    const rows = await h.query<{ source: string; note: string }>(
      `select source, note from grants where user_id = '${user.id}' and source = 'admin'`,
    );
    expect(rows).toEqual([{ source: "admin", note: "support gift" }]);
  });

  it("refuses an empty grant", async () => {
    const { user } = await signIn(h);
    const res = await h.call("POST", `/v1/admin/users/${user.id}/grant`, {
      headers: admin(),
      body: {},
    });
    expect(res.status).toBe(400);
  });
});

describe("block", () => {
  it("blocking revokes every session, and the user is locked out", async () => {
    const { user, access, refresh } = await signIn(h);

    const res = await h.call("POST", `/v1/admin/users/${user.id}/block`, {
      headers: admin(),
      body: { blocked: true },
    });
    expect((await res.json()).blocked).toBe(true);

    // Refresh dies instantly; the access token dies at the auth guard.
    expect((await h.call("POST", "/v1/auth/token/refresh", { body: { refresh } })).status).toBe(
      401,
    );
    expect((await h.call("GET", "/v1/subscriptions/me", { headers: auth(access) })).status).toBe(
      403,
    );
  });
});

describe("discounts", () => {
  it("creates, lists, rejects duplicates, and toggles", async () => {
    const created = await h.call("POST", "/v1/admin/discounts", {
      headers: admin(),
      body: { code: "EID1405", percent: 30, maxUses: 100 },
    });
    expect(created.status).toBe(200);

    const dup = await h.call("POST", "/v1/admin/discounts", {
      headers: admin(),
      body: { code: "eid1405", percent: 10 },
    });
    expect(dup.status).toBe(400);

    const toggled = await h.call("POST", "/v1/admin/discounts/EID1405", {
      headers: admin(),
      body: { active: false },
    });
    expect((await toggled.json()).discount.active).toBe(false);

    const list = await (await h.call("GET", "/v1/admin/discounts", { headers: admin() })).json();
    expect(list.discounts).toHaveLength(1);
    expect(list.discounts[0].code).toBe("EID1405");
  });
});

describe("payments listing", () => {
  it("joins the payer phone and filters by status", async () => {
    const { access } = await signIn(h);
    await h.call("POST", "/v1/payments/checkout", {
      headers: auth(access),
      body: { planId: "m1" },
    });

    const all = await (await h.call("GET", "/v1/admin/payments", { headers: admin() })).json();
    expect(all.payments).toHaveLength(1);
    expect(all.payments[0].phone).toBe("989123334444");

    const none = await (
      await h.call("GET", "/v1/admin/payments?status=paid", { headers: admin() })
    ).json();
    expect(none.payments).toHaveLength(0);
  });
});
