import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "../src/db/ddl.js";
import { schema } from "../src/db/schema.js";
import { applyPaid } from "../src/services/payment-flow.js";
import { claimReferralCode } from "../src/services/referral.js";

const connectionString = process.env.ROUTINO_TEST_POSTGRES_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres("referral claim/payment race on real PostgreSQL", () => {
  let admin: Client;
  let pool: Pool;

  beforeAll(async () => {
    admin = new Client({ connectionString });
    pool = new Pool({ connectionString, max: 6 });
    await admin.connect();
    await admin.query(SCHEMA_SQL);
  }, 20_000);

  afterAll(async () => {
    await admin?.end();
    await pool?.end();
  });

  it("serializes a last-moment claim with the first paid purchase", async () => {
    await admin.query(`
      truncate table referrals, entitlements, grants, payments, users restart identity cascade;
      update referral_program_policy set started_at = '-infinity' where key = 'referral_v1';
    `);
    const db = drizzle(pool, { schema });
    const [inviter, invitee] = await db
      .insert(schema.users)
      .values([{ phone: "989127770001", referralCode: "RACECX" }, { phone: "989127770002" }])
      .returning();
    if (!inviter || !invitee) throw new Error("fixture failed");
    const [payment] = await db
      .insert(schema.payments)
      .values({
        userId: invitee.id,
        planId: "m1",
        months: 1,
        amountToman: 59_000,
        amountRial: 590_000,
        status: "redirected",
        authority: "RACE-AUTHORITY",
      })
      .returning();
    if (!payment) throw new Error("payment fixture failed");

    const [claim, paid] = await Promise.allSettled([
      claimReferralCode(db, invitee.id, "RACECX", new Date()),
      applyPaid(db, payment, { kind: "paid", code: 100, refNumber: "RACE-REF" }, new Date()),
    ]);
    expect(paid.status).toBe("fulfilled");

    const referralRows = await db.select().from(schema.referrals);
    const rewardRows = await db
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.source, "referral"));
    if (claim.status === "fulfilled") {
      expect(referralRows).toHaveLength(1);
      expect(referralRows[0]?.successfulAt).not.toBeNull();
      expect(rewardRows).toHaveLength(2);
    } else {
      expect(referralRows).toHaveLength(0);
      expect(rewardRows).toHaveLength(0);
    }
  }, 10_000);
});
