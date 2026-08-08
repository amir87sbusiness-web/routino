/**
 * A launch-day burst: many sales landing at once.
 *
 * The advertising push means the first sales arrive together rather than spread
 * out, so every race in the money path gets exercised on day one instead of
 * month six. What must hold: one payment grants exactly one subscription, one
 * user's payment never touches another user's account, and a limited discount
 * code cannot be spent more times than it has slots.
 *
 * Caveat worth knowing: PGlite runs one connection, so this interleaves at the
 * await points rather than running truly in parallel. It catches read-then-write
 * logic races (which is where this class of bug actually lives); it does not
 * substitute for load-testing real Postgres.
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

async function checkout(access: string, code?: string) {
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/payments/checkout",
    headers: auth(access),
    payload: code ? { planId: "m1", code } : { planId: "m1" },
  });
  return { status: res.statusCode, body: res.json() as { paymentId: string; trackId: number } };
}

const callback = (paymentId: string, trackId: number) =>
  h.app.inject({
    method: "GET",
    url: `/v1/payments/callback?trackId=${trackId}&success=1&status=2&orderId=${paymentId}`,
  });

const grantCount = async (paymentId: string) => {
  const rows = await h.query<{ n: number }>(
    `select count(*)::int as n from grants where payment_id = '${paymentId}'`,
  );
  return Number(rows[0]!.n);
};

describe("a burst of simultaneous sales", () => {
  it("gives each of 20 buyers exactly one month, and nobody two", async () => {
    const buyers = await Promise.all(
      Array.from({ length: 20 }, (_, i) => signIn(`0912200${String(i).padStart(4, "0")}`)),
    );
    const orders = await Promise.all(buyers.map((b) => checkout(b.access)));
    expect(orders.every((o) => o.status === 200)).toBe(true);

    for (const o of orders) h.psp._settle(o.body.trackId, "paid");

    // Every callback fires at once, the way 20 browsers coming back would.
    await Promise.all(orders.map((o) => callback(o.body.paymentId, o.body.trackId)));

    for (const o of orders) expect(await grantCount(o.body.paymentId)).toBe(1);

    // And each account got its own month — no grant landed on a stranger.
    for (const b of buyers) {
      const rows = await h.query<{ n: number }>(
        `select count(*)::int as n from grants where user_id = '${b.user.id}' and source = 'payment'`,
      );
      expect(Number(rows[0]!.n)).toBe(1);
    }
  });

  it("grants once when the same callback is delivered five times at once", async () => {
    const { access } = await signIn("09122100001");
    const { body } = await checkout(access);
    h.psp._settle(body.trackId, "paid");

    // A retrying browser, a double-tap, and the gateway's own retry all at once.
    await Promise.all(Array.from({ length: 5 }, () => callback(body.paymentId, body.trackId)));

    expect(await grantCount(body.paymentId)).toBe(1);
  });

  it("grants once when the callback and the app-open recovery race", async () => {
    const { access } = await signIn("09122100002");
    const { body } = await checkout(access);
    h.psp._settle(body.trackId, "paid");

    // The redirect lands at the same moment the user reopens the app on their
    // phone — both paths try to finish the same payment.
    await Promise.all([
      callback(body.paymentId, body.trackId),
      h.app.inject({ method: "GET", url: "/v1/sync/pull?cursor=0", headers: auth(access) }),
      h.app.inject({ method: "GET", url: `/v1/payments/${body.paymentId}`, headers: auth(access) }),
    ]);

    expect(await grantCount(body.paymentId)).toBe(1);
  });

  it("does not let a single-use discount code be spent twice", async () => {
    await h.raw(
      `insert into discounts (code, percent, active, max_uses) values ('BURST1', 50, true, 1)`,
    );
    const buyers = await Promise.all(
      Array.from({ length: 6 }, (_, i) => signIn(`0912220${String(i).padStart(4, "0")}`)),
    );

    const results = await Promise.all(buyers.map((b) => checkout(b.access, "BURST1")));
    const discounted = results.filter((r) => r.status === 200);

    for (const r of discounted) {
      h.psp._settle(r.body.trackId, "paid");
      await callback(r.body.paymentId, r.body.trackId);
    }

    const rows = await h.query<{ n: number }>(
      `select count(*)::int as n from redemptions where code = 'BURST1'`,
    );
    expect(Number(rows[0]!.n)).toBeLessThanOrEqual(1);
  });

  it("adds BOTH months when one user's two payments settle at the same instant", async () => {
    const { access, user } = await signIn("09122100003");

    // Someone double-taps, or buys on the phone and the laptop at once. Two
    // separate payments, both genuinely paid.
    const a = await checkout(access);
    const b = await checkout(access);
    h.psp._settle(a.body.trackId, "paid");
    h.psp._settle(b.body.trackId, "paid");

    const before = await h.query<{ expires_at: string }>(
      `select expires_at::text from entitlements where user_id = '${user.id}'`,
    );
    const start = new Date(before[0]!.expires_at).getTime();

    await Promise.all([
      callback(a.body.paymentId, a.body.trackId),
      callback(b.body.paymentId, b.body.trackId),
    ]);

    // Two grants, one per payment — neither swallowed the other.
    expect(await grantCount(a.body.paymentId)).toBe(1);
    expect(await grantCount(b.body.paymentId)).toBe(1);

    // And the entitlement moved by ~two months, not one. This is the failure the
    // single-statement `insert … on conflict … greatest(expires_at, now) +
    // make_interval` exists to prevent: read-then-write let two grants landing
    // together drop one, so a user who paid twice got one month.
    const after = await h.query<{ expires_at: string }>(
      `select expires_at::text from entitlements where user_id = '${user.id}'`,
    );
    const days = (new Date(after[0]!.expires_at).getTime() - start) / 86_400_000;
    expect(days).toBeGreaterThan(55);
  });

  it("keeps each buyer's sync data to themselves under load", async () => {
    const buyers = await Promise.all(
      Array.from({ length: 10 }, (_, i) => signIn(`0912230${String(i).padStart(4, "0")}`)),
    );

    await Promise.all(
      buyers.map((b, i) =>
        h.app.inject({
          method: "POST",
          url: "/v1/sync/push",
          headers: auth(b.access),
          payload: {
            records: [
              { kind: "habits", id: `h${i}`, data: { owner: i }, updatedAt: 1000, deleted: false },
            ],
          },
        }),
      ),
    );

    const pulls = await Promise.all(
      buyers.map((b) =>
        h.app.inject({ method: "GET", url: "/v1/sync/pull?cursor=0", headers: auth(b.access) }),
      ),
    );

    pulls.forEach((res, i) => {
      const body = res.json() as { records: { id: string; data: { owner: number } }[] };
      const habits = body.records.filter((r) => r.id.startsWith("h"));
      expect(habits).toHaveLength(1);
      expect(habits[0]!.data.owner).toBe(i);
    });
  });
});
