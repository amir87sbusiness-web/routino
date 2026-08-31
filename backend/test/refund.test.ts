/**
 * What happens after money comes BACK.
 *
 * A user can pay, get their subscription, and then have the money returned —
 * they ask ZarinPal for a refund, the bank reverses the transaction, or they
 * file a chargeback. None of that reaches this server: the gateway does not
 * call our callback for a refund, and nothing here polls for one. So the
 * subscription stays active on money the owner no longer has.
 *
 * That is an accepted risk rather than a bug to fix — detecting it would mean
 * re-verifying every paid payment forever, against a gateway that charges for
 * the privilege, to catch something rare on a 59,000-Toman app. What is NOT
 * acceptable is having no way to CORRECT it once the owner notices, which is
 * what these tests pin down.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminSignIn, makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
let admin: Record<string, string>;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  h.psp._txns.clear();
  admin = await adminSignIn(h);
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

/** Buys a month for real: checkout, settle at the gateway, deliver the callback. */
async function buyAMonth(access: string) {
  const co = await h.app.inject({
    method: "POST",
    url: "/v1/payments/checkout",
    headers: auth(access),
    payload: { planId: "m1", attemptId: crypto.randomUUID() },
  });
  const { paymentId, authority } = co.json() as { paymentId: string; authority: string };
  h.psp._settle(authority, "paid");
  await h.app.inject({
    method: "GET",
    url: `/v1/payments/callback?paymentId=${paymentId}&Authority=${authority}&Status=OK`,
  });
  return paymentId;
}

async function startTrial(access: string) {
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/subscriptions/trial/start",
    headers: auth(access),
  });
  expect(res.statusCode).toBe(200);
}

const daysLeft = async (userId: string) => {
  const rows = await h.query<{ expires_at: string | null }>(
    `select expires_at::text from entitlements where user_id = '${userId}'`,
  );
  if (!rows[0]?.expires_at) return 0;
  return (new Date(rows[0].expires_at).getTime() - Date.now()) / 86_400_000;
};

/** Two reads of the same expiry differ by the milliseconds between them. */
const sameExpiry = (a: number, b: number) => Math.abs(a - b) < 0.001;

describe("money that comes back", () => {
  it("documents the gap: a refund at the gateway does NOT reach us", async () => {
    const { access, user } = await signIn("09137770001");
    await buyAMonth(access);
    const afterPurchase = await daysLeft(user.id);
    // Payment plans add calendar months, not a hard-coded 30 × 24h interval.
    // The shortest Gregorian month is 28 days and the assertion runs after the
    // grant timestamp, so 27 is the correct lower bound.
    expect(afterPurchase).toBeGreaterThan(27);

    // A refund happens entirely at ZarinPal/the bank. There is no callback for
    // it and nothing polls for it, so from this server's point of view nothing
    // happened at all. Asserted so the gap is a known, tested fact rather than
    // an assumption somebody discovers during a dispute.
    expect(sameExpiry(await daysLeft(user.id), afterPurchase)).toBe(true);
  });

  it("lets the owner subtract the refunded month, leaving the rest intact", async () => {
    const { access, user } = await signIn("09137770002");
    // This scenario intentionally verifies that a paid month stacks on, and a
    // refund peels back to, the remaining explicitly activated trial.
    await startTrial(access);
    await buyAMonth(access);
    const before = await daysLeft(user.id);
    expect(before).toBeGreaterThan(30);

    // The proportionate remedy: take back exactly what was refunded, instead of
    // blocking the whole account. The API used to reject this outright
    // (`months: min(0)`), so blocking was the only option available.
    const res = await h.app.inject({
      method: "POST",
      url: `/v1/admin/users/${user.id}/grant`,
      headers: admin,
      payload: { months: -1, planId: "refund", note: "zarinpal refund #123" },
    });
    expect(res.statusCode).toBe(200);

    // A month came off, and the trial days underneath it survive.
    const after = await daysLeft(user.id);
    expect(after).toBeLessThan(before - 27);
    expect(after).toBeGreaterThan(0);

    // The correction lands on the append-only ledger with its reason, so
    // "why did my subscription shrink" stays answerable months later.
    const rows = await h.query<{ months: number; note: string | null; source: string }>(
      `select months, note, source from grants where user_id = '${user.id}' order by created_at desc limit 1`,
    );
    expect(Number(rows[0]!.months)).toBe(-1);
    expect(rows[0]!.source).toBe("admin");
    expect(rows[0]!.note).toContain("refund");
  });

  it("still refuses a grant of exactly zero", async () => {
    const { user } = await signIn("09137770003");
    const res = await h.app.inject({
      method: "POST",
      url: `/v1/admin/users/${user.id}/grant`,
      headers: admin,
      payload: { months: 0, days: 0 },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
