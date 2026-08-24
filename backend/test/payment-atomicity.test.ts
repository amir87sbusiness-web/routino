import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "../src/db/schema.js";
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

async function paymentFixture() {
  const [user] = await h.db
    .insert(schema.users)
    .values({ phone: "989121234567" })
    .returning();
  if (!user) throw new Error("user fixture failed");

  const [payment] = await h.db
    .insert(schema.payments)
    .values({
      userId: user.id,
      planId: "m1",
      months: 1,
      amountToman: 59_000,
      amountRial: 590_000,
      status: "redirected",
      provider: "fake",
      trackId: 123_456,
    })
    .returning();
  if (!payment) throw new Error("payment fixture failed");
  return { user, payment };
}

describe("atomic verified-payment grant", () => {
  it("rolls back entitlement and payment state when the payment grant cannot be recorded", async () => {
    const { user, payment } = await paymentFixture();

    await h.raw(`
      create or replace function reject_payment_grant() returns trigger
      language plpgsql as $$
      begin
        if new.payment_id = '${payment.id}'::uuid then
          raise exception 'injected grant failure';
        end if;
        return new;
      end;
      $$;
      create trigger reject_payment_grant_before_insert
      before insert on grants
      for each row execute function reject_payment_grant();
    `);

    await expect(
      applyPaid(h.db, payment, { result: 100, status: 1, refNumber: "SAFE-REF" }, new Date()),
    ).rejects.toThrow();

    const [freshPayment] = await h.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));
    const entitlementRows = await h.db
      .select()
      .from(schema.entitlements)
      .where(eq(schema.entitlements.userId, user.id));
    const grantRows = await h.db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.paymentId, payment.id));

    expect(freshPayment?.status).toBe("redirected");
    expect(freshPayment?.appliedAt).toBeNull();
    expect(entitlementRows).toHaveLength(0);
    expect(grantRows).toHaveLength(0);
  });

  it("extends entitlement and records the payment grant once under duplicate apply calls", async () => {
    const { user, payment } = await paymentFixture();
    const now = new Date("2026-08-24T10:00:00.000Z");

    await Promise.all(
      Array.from({ length: 5 }, () =>
        applyPaid(h.db, payment, { result: 100, status: 1, refNumber: "SAFE-REF" }, now),
      ),
    );

    const [freshPayment] = await h.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, payment.id));
    const [entitlement] = await h.db
      .select()
      .from(schema.entitlements)
      .where(eq(schema.entitlements.userId, user.id));
    const grantRows = await h.db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.paymentId, payment.id));

    expect(freshPayment?.status).toBe("paid");
    expect(freshPayment?.appliedAt?.toISOString()).toBe(now.toISOString());
    expect(grantRows).toHaveLength(1);
    expect(grantRows[0]?.expiresBefore).toBeNull();
    expect(grantRows[0]?.expiresAfter?.toISOString()).toBe("2026-09-24T10:00:00.000Z");
    expect(entitlement?.expiresAt.toISOString()).toBe("2026-09-24T10:00:00.000Z");
  });
});
