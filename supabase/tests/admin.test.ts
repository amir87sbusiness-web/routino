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

  it("throttles repeated wrong tokens without locking out the real one", async () => {
    // This app IS production, and there is no HTTP rate limiter in front of it —
    // so the guessing limit has to live here, backed by Postgres rather than an
    // in-memory counter that a cold start would reset.
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push(
        (await h.call("GET", "/v1/admin/overview", { headers: { "x-admin-token": `g${i}` } }))
          .status,
      );
    }
    expect(codes.slice(0, 9)).toEqual(Array(9).fill(401));
    expect(codes.slice(9)).toEqual(Array(3).fill(429));
    expect((await h.call("GET", "/v1/admin/overview", { headers: admin() })).status).toBe(200);
  });

  it("sends security headers, and a CSP on the panel", async () => {
    // helmet only ever covered the Fastify deployment; these are the headers the
    // real api.routino.me was missing entirely.
    const res = await h.call("GET", "/admin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("serves the panel shell publicly (reveals nothing without a token)", async () => {
    const res = await h.call("GET", "/admin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    // The marker the Cloudflare Worker keys on to repair the Supabase gateway's
    // text/plain downgrade + sandbox CSP.
    expect(res.headers.get("x-routino-html")).toBe("1");
    expect(await res.text()).toContain("پنل مدیریت");
  });
});

describe("overview + users", () => {
  it("counts users and finds them by local-format phone search", async () => {
    await signIn(h, "09123334444");
    await signIn(h, "09351112222");

    const ov = await (await h.call("GET", "/v1/admin/overview", { headers: admin() })).json();
    expect(ov.users.total).toBe(2);
    // Money-safety + ops fields the panel surfaces.
    expect(ov.alerts.verifyFailed).toBe(0);
    expect(ov.payments.pending).toBe(0);

    const found = await (
      await h.call("GET", "/v1/admin/users?q=0912333", { headers: admin() })
    ).json();
    expect(found.users).toHaveLength(1);
    expect(found.users[0].phone).toBe("989123334444");
  });

  it("surfaces a verify_failed payment as an alert (never should happen)", async () => {
    const { user } = await signIn(h);
    await h.raw(
      `insert into payments (user_id, plan_id, months, amount_toman, amount_rial, status)
       values ('${user.id}', 'm1', 1, 59000, 590000, 'verify_failed')`,
    );
    const ov = await (await h.call("GET", "/v1/admin/overview", { headers: admin() })).json();
    expect(ov.alerts.verifyFailed).toBe(1);
  });
});

describe("manual grant", () => {
  it("extends entitlement and writes an auditable ledger row", async () => {
    const { user } = await signIn(h);
    const before = Date.now();
    const res = await h.call("POST", `/v1/admin/users/${user.id}/grant`, {
      headers: admin(),
      body: { months: 1, note: "support gift" },
    });
    expect(res.status).toBe(200);
    const after = Date.parse((await res.json()).entitlement.expiresAt);
    expect(after).toBeGreaterThan(before + 27 * 86_400_000);

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

describe("user detail", () => {
  it("returns devices, payments, grants and entitlement for support", async () => {
    const { user, access } = await signIn(h);
    await h.call("POST", "/v1/payments/checkout", {
      headers: auth(access),
      body: { planId: "m1", attemptId: crypto.randomUUID() },
    });

    const d = await (
      await h.call("GET", `/v1/admin/users/${user.id}`, { headers: admin() })
    ).json();
    expect(d.user.phone).toBe("989123334444");
    expect(d.entitlement).toMatchObject({ status: "none", planId: null, expiresAt: null });
    expect(d.devices).toHaveLength(1); // the sign-in device
    expect(d.grants).toHaveLength(0);
    expect(d.payments).toHaveLength(1); // the pending checkout
  });

  it("404s an unknown user and 400s a malformed id", async () => {
    expect(
      (
        await h.call("GET", "/v1/admin/users/11111111-1111-1111-1111-111111111111", {
          headers: admin(),
        })
      ).status,
    ).toBe(404);
    expect((await h.call("GET", "/v1/admin/users/not-a-uuid", { headers: admin() })).status).toBe(
      400,
    );
  });
});

describe("device policy", () => {
  it("does not expose obsolete device quota administration", async () => {
    const { user } = await signIn(h);
    const response = await h.call("POST", `/v1/admin/users/${user.id}/device-policy`, {
      headers: admin(),
      body: { maxActiveDevices: 3 },
    });
    expect(response.status).toBe(404);
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
      body: { planId: "m1", attemptId: crypto.randomUUID() },
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
