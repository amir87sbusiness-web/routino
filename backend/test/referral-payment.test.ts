import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "../src/db/schema.js";
import { grantInterval } from "../src/services/entitlement.js";
import { getReferralSummary } from "../src/services/referral.js";
import { applyPaid } from "../src/services/payment-flow.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

const NOW = new Date("2026-09-26T12:00:00.000Z");

async function referralPaymentFixture(opts: { inviterEntitlement?: boolean } = {}) {
  const [inviter] = await h.db
    .insert(schema.users)
    .values({ phone: "989121230001", referralCode: "INVITE" })
    .returning();
  const [invitee] = await h.db
    .insert(schema.users)
    .values({ phone: "989121230002", referralCode: "FRIEND" })
    .returning();
  if (!inviter || !invitee) throw new Error("user fixture failed");

  if (opts.inviterEntitlement !== false) {
    await grantInterval(
      h.db,
      inviter.id,
      { planId: "m3", days: 5, source: "admin" },
      new Date("2026-10-01T12:00:00.000Z"),
    );
  }

  const [referral] = await h.db
    .insert(schema.referrals)
    .values({
      inviterId: inviter.id,
      inviteeId: invitee.id,
      claimedCode: "INVITE",
      claimedAt: new Date("2026-09-25T12:00:00.000Z"),
    })
    .returning();
  const [payment] = await h.db
    .insert(schema.payments)
    .values({
      userId: invitee.id,
      planId: "m1",
      months: 1,
      amountToman: 59_000,
      amountRial: 590_000,
      status: "redirected",
      authority: `AUTH-${crypto.randomUUID()}`,
    })
    .returning();
  if (!referral || !payment) throw new Error("referral payment fixture failed");
  return { inviter, invitee, referral, payment };
}

const verifyPaid = { kind: "paid", code: 100, refNumber: "REF-100" } as const;

describe("referral rewards in the verified-payment transaction", () => {
  it("rewards both accounts once, after the purchased plan, while preserving the inviter plan", async () => {
    const { inviter, invitee, referral, payment } = await referralPaymentFixture();

    await applyPaid(h.db, payment, verifyPaid, NOW);

    const [successful] = await h.db
      .select()
      .from(schema.referrals)
      .where(eq(schema.referrals.id, referral.id));
    expect(successful).toMatchObject({ successfulPaymentId: payment.id });
    expect(successful?.successfulAt?.toISOString()).toBe(NOW.toISOString());

    const rewards = await h.db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.source, "referral"));
    expect(rewards).toHaveLength(2);
    expect(new Set(rewards.map((grant) => grant.userId))).toEqual(
      new Set([inviter.id, invitee.id]),
    );
    expect(rewards.every((grant) => grant.days === 7 && grant.idempotencyKey)).toBe(true);
    expect(new Set(rewards.map((grant) => grant.idempotencyKey)).size).toBe(2);

    const [inviteeEntitlement] = await h.db
      .select()
      .from(schema.entitlements)
      .where(eq(schema.entitlements.userId, invitee.id));
    expect(inviteeEntitlement?.planId).toBe("m1");
    expect(inviteeEntitlement?.expiresAt.toISOString()).toBe("2026-11-02T12:00:00.000Z");

    const [inviterEntitlement] = await h.db
      .select()
      .from(schema.entitlements)
      .where(eq(schema.entitlements.userId, inviter.id));
    expect(await getReferralSummary(h.db, inviter.id)).toMatchObject({
      successfulInvites: 1,
      earnedDays: 7,
    });
    expect(await getReferralSummary(h.db, invitee.id)).toMatchObject({
      successfulInvites: 0,
      earnedDays: 7,
      claimState: { status: "claimed", rewarded: true },
    });
    expect(inviterEntitlement?.planId).toBe("m3");
    expect(inviterEntitlement?.expiresAt.toISOString()).toBe("2026-10-13T12:00:00.000Z");
  });

  it("uses the internal referral plan only when the inviter has no entitlement", async () => {
    const { inviter, payment } = await referralPaymentFixture({ inviterEntitlement: false });
    await applyPaid(h.db, payment, verifyPaid, NOW);

    const [entitlement] = await h.db
      .select()
      .from(schema.entitlements)
      .where(eq(schema.entitlements.userId, inviter.id));
    expect(entitlement?.planId).toBe("referral");
    expect(entitlement?.expiresAt.toISOString()).toBe("2026-10-03T12:00:00.000Z");
  });

  it("creates one reward pair under five duplicate callbacks", async () => {
    const { payment } = await referralPaymentFixture();
    await Promise.all(Array.from({ length: 5 }, () => applyPaid(h.db, payment, verifyPaid, NOW)));

    const rewards = await h.db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.source, "referral"));
    expect(rewards).toHaveLength(2);
  });

  it("creates only one reward pair when two distinct first payments settle together", async () => {
    const { invitee, payment: first } = await referralPaymentFixture();
    const [second] = await h.db
      .insert(schema.payments)
      .values({
        userId: invitee.id,
        planId: "m3",
        months: 3,
        amountToman: 149_000,
        amountRial: 1_490_000,
        status: "redirected",
        authority: `AUTH-${crypto.randomUUID()}`,
      })
      .returning();
    if (!second) throw new Error("second payment fixture failed");

    await Promise.all([
      applyPaid(h.db, first, verifyPaid, NOW),
      applyPaid(h.db, second, { ...verifyPaid, refNumber: "REF-SECOND" }, NOW),
    ]);

    const rewards = await h.db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.source, "referral"));
    expect(rewards).toHaveLength(2);
    const [referral] = await h.db.select().from(schema.referrals);
    expect([first.id, second.id]).toContain(referral?.successfulPaymentId);
  });

  it("does not reward a later purchase", async () => {
    const { invitee, payment: first } = await referralPaymentFixture();
    await applyPaid(h.db, first, verifyPaid, NOW);
    const [later] = await h.db
      .insert(schema.payments)
      .values({
        userId: invitee.id,
        planId: "m1",
        months: 1,
        amountToman: 59_000,
        amountRial: 590_000,
        status: "redirected",
        authority: `AUTH-${crypto.randomUUID()}`,
      })
      .returning();
    if (!later) throw new Error("later payment fixture failed");
    await applyPaid(h.db, later, { ...verifyPaid, refNumber: "REF-LATER" }, NOW);

    const rewards = await h.db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.source, "referral"));
    expect(rewards).toHaveLength(2);
  });

  it.each([
    ["zero amount", 0, "AUTH-ZERO", 100],
    ["missing authority", 59_000, null, 100],
    ["synthetic authority", 59_000, "FREE", 100],
  ])("does not reward a %s direct grant", async (_label, amountToman, authority, code) => {
    const { payment } = await referralPaymentFixture();
    const nonQualifying = {
      ...payment,
      amountToman,
      authority,
    };
    await applyPaid(
      h.db,
      nonQualifying,
      { kind: "paid", code: code as 100, refNumber: "FREE" },
      NOW,
      authority,
    );
    expect(
      await h.db.select().from(schema.grants).where(eq(schema.grants.source, "referral")),
    ).toHaveLength(0);
  });

  it("does not let trial or admin grants trigger referral success", async () => {
    const { invitee, referral } = await referralPaymentFixture();
    await grantInterval(h.db, invitee.id, { planId: "trial", days: 3, source: "trial" }, NOW);
    await grantInterval(h.db, invitee.id, { planId: "admin", days: 2, source: "admin" }, NOW);

    const [fresh] = await h.db
      .select()
      .from(schema.referrals)
      .where(eq(schema.referrals.id, referral.id));
    expect(fresh?.successfulAt).toBeNull();
    expect(
      await h.db.select().from(schema.grants).where(eq(schema.grants.source, "referral")),
    ).toHaveLength(0);
  });

  it("rolls back payment, entitlement, referral success and both rewards on reward failure", async () => {
    const { invitee, referral, payment } = await referralPaymentFixture();
    await h.raw(`
      create or replace function reject_referral_reward() returns trigger
      language plpgsql as $$
      begin
        if new.source = 'referral' then raise exception 'injected reward failure'; end if;
        return new;
      end;
      $$;
      create trigger reject_referral_reward_before_insert
      before insert on grants for each row execute function reject_referral_reward();
    `);

    await expect(applyPaid(h.db, payment, verifyPaid, NOW)).rejects.toThrow();
    await h.raw(`
      drop trigger reject_referral_reward_before_insert on grants;
      drop function reject_referral_reward();
    `);

    const [freshPayment] = await h.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));
    const [freshReferral] = await h.db
      .select()
      .from(schema.referrals)
      .where(eq(schema.referrals.id, referral.id));
    expect(freshPayment).toMatchObject({ status: "redirected", appliedAt: null });
    expect(freshReferral).toMatchObject({ successfulAt: null, successfulPaymentId: null });
    expect(
      await h.db
        .select()
        .from(schema.entitlements)
        .where(eq(schema.entitlements.userId, invitee.id)),
    ).toHaveLength(0);
    expect(
      await h.db.select().from(schema.grants).where(eq(schema.grants.paymentId, payment.id)),
    ).toHaveLength(0);
  });

  it("keeps the invitee reward when the inviter was deleted before purchase", async () => {
    const { inviter, invitee, referral, payment } = await referralPaymentFixture();
    await h.db.delete(schema.users).where(eq(schema.users.id, inviter.id));

    await applyPaid(h.db, payment, verifyPaid, NOW);

    const [successful] = await h.db
      .select()
      .from(schema.referrals)
      .where(eq(schema.referrals.id, referral.id));
    expect(successful).toMatchObject({ inviterId: null, successfulPaymentId: payment.id });
    const rewards = await h.db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.source, "referral"));
    expect(rewards).toHaveLength(1);
    expect(rewards[0]?.userId).toBe(invitee.id);
  });
});
