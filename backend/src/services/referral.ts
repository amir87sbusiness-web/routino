import { and, eq, isNull, sql } from "drizzle-orm";
import { rowsOf, type Database, type DatabaseExecutor } from "../db/client.js";
import { referrals, users } from "../db/schema.js";
import { badRequest, conflict, unauthorized } from "../lib/http-errors.js";

export const REFERRAL_REWARD_DAYS = 7;
const REFERRAL_CODE_LENGTH = 6;
const REFERRAL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_CODE_ASSIGNMENT_ATTEMPTS = 8;

export type ReferralClaimState =
  | { status: "eligible" }
  | { status: "claimed" }
  | {
      status: "ineligible";
      reason: "account_predates_program" | "paid_purchase_exists";
    };

export interface ReferralSummary {
  referralCode: string;
  rewardDays: 7;
  successfulInvites: number;
  earnedDays: number;
  claimState: ReferralClaimState;
}

export type ReferralCodeGenerator = () => string;

/** Rejection sampling avoids modulo bias while retaining browser/Deno-compatible
 * Web Crypto rather than importing a Node-only randomness API. */
export function generateReferralCode(): string {
  let code = "";
  while (code.length < REFERRAL_CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(REFERRAL_CODE_LENGTH));
    for (const byte of bytes) {
      if (byte >= 234) continue;
      code += REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length];
      if (code.length === REFERRAL_CODE_LENGTH) break;
    }
  }
  return code;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function ensureReferralCode(
  db: DatabaseExecutor,
  userId: string,
  generateCode: ReferralCodeGenerator = generateReferralCode,
): Promise<string> {
  const [account] = await db
    .select({ referralCode: users.referralCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) throw unauthorized("unknown_user", "User no longer exists");
  if (account.referralCode) return account.referralCode;

  for (let attempt = 0; attempt < MAX_CODE_ASSIGNMENT_ATTEMPTS; attempt += 1) {
    const candidate = generateCode();
    if (!/^[A-Z]{6}$/.test(candidate)) {
      throw new Error("referral code generator returned an invalid code");
    }
    try {
      const [assigned] = await db
        .update(users)
        .set({ referralCode: candidate })
        .where(and(eq(users.id, userId), isNull(users.referralCode)))
        .returning();
      if (assigned?.referralCode) return assigned.referralCode;

      const [concurrent] = await db
        .select({ referralCode: users.referralCode })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!concurrent) throw unauthorized("unknown_user", "User no longer exists");
      if (concurrent.referralCode) return concurrent.referralCode;
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }
  throw new Error("could not allocate a unique referral code");
}

interface ReferralStateRow {
  account_predates_program: boolean;
  has_claim: boolean;
  has_paid_purchase: boolean;
  successful_invites: number | string;
}

async function readReferralState(db: DatabaseExecutor, userId: string): Promise<ReferralStateRow> {
  const rows = rowsOf<ReferralStateRow>(
    await db.execute(sql`
        select u.created_at < policy.started_at as account_predates_program,
               exists (
                 select 1 from referrals r where r.invitee_id = u.id
               ) as has_claim,
               exists (
                 select 1 from payments p
                  where p.user_id = u.id
                    and p.status = 'paid'
                    and p.amount_toman > 0
                    and nullif(btrim(p.authority), '') is not null
                    and upper(btrim(p.authority)) <> 'FREE'
                    and p.psp_result in (100, 101)
                    and p.applied_at is not null
               ) as has_paid_purchase,
               (
                 select count(*) from referrals r
                  where r.inviter_id = u.id and r.successful_at is not null
               ) as successful_invites
          from users u
          cross join referral_program_policy policy
         where u.id = ${userId} and policy.key = 'referral_v1'
         limit 1
      `),
  );
  const row = rows[0];
  if (!row) throw unauthorized("unknown_user", "User no longer exists");
  return row;
}

function claimStateFor(row: ReferralStateRow): ReferralClaimState {
  if (row.has_claim) return { status: "claimed" };
  if (row.account_predates_program) {
    return { status: "ineligible", reason: "account_predates_program" };
  }
  if (row.has_paid_purchase) {
    return { status: "ineligible", reason: "paid_purchase_exists" };
  }
  return { status: "eligible" };
}

export async function getReferralSummary(
  db: DatabaseExecutor,
  userId: string,
): Promise<ReferralSummary> {
  const referralCode = await ensureReferralCode(db, userId);
  const state = await readReferralState(db, userId);
  const successfulInvites = Number(state.successful_invites);
  return {
    referralCode,
    rewardDays: REFERRAL_REWARD_DAYS,
    successfulInvites,
    earnedDays: successfulInvites * REFERRAL_REWARD_DAYS,
    claimState: claimStateFor(state),
  };
}

export async function claimReferralCode(
  db: Database,
  inviteeId: string,
  rawCode: string,
  now: Date,
): Promise<ReferralSummary> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z]{6}$/.test(code)) {
    throw badRequest("invalid_referral_code", "Enter a valid six-letter referral code");
  }

  await ensureReferralCode(db, inviteeId);
  await db.transaction(async (tx) => {
    const [inviter] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);
    if (!inviter) {
      throw badRequest("invalid_referral_code", "Enter a valid six-letter referral code");
    }

    const accounts = rowsOf<{ id: string }>(
      await tx.execute(sql`
        select id from users
         where id in (${inviteeId}, ${inviter.id})
         order by id
         for update
      `),
    );
    if (!accounts.some((account) => account.id === inviteeId)) {
      throw unauthorized("unknown_user", "User no longer exists");
    }
    if (!accounts.some((account) => account.id === inviter.id)) {
      throw badRequest("invalid_referral_code", "Enter a valid six-letter referral code");
    }

    const [existing] = await tx
      .select({ claimedCode: referrals.claimedCode })
      .from(referrals)
      .where(eq(referrals.inviteeId, inviteeId))
      .limit(1);
    if (existing) {
      if (existing.claimedCode === code) return;
      throw conflict("referral_already_claimed", "A different referral code is already claimed");
    }

    const state = await readReferralState(tx, inviteeId);
    const eligibility = claimStateFor(state);
    if (eligibility.status === "ineligible") {
      throw conflict("referral_not_eligible", "This account is not eligible to claim a referral");
    }

    if (inviter.id === inviteeId) {
      throw badRequest("self_referral", "You cannot use your own referral code");
    }

    await tx.insert(referrals).values({
      inviterId: inviter.id,
      inviteeId,
      claimedCode: code,
      claimedAt: now,
    });
  });

  return getReferralSummary(db, inviteeId);
}
