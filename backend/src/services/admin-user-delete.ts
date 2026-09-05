/**
 * Permanent account deletion initiated from the owner-only admin panel.
 *
 * This is intentionally separate from ordinary account-retention cleanup:
 * admin deletion is explicit, immediate and destructive. The target user row is
 * locked first so concurrent sync/payment work cannot race a half-deleted
 * account. Personal/product data is removed in one transaction; financial
 * payment history is preserved but detached from the deleted account.
 */
import { createHmac } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.js";
import {
  authRateLimitBuckets,
  feedback,
  otpCodes,
  redemptions,
  users,
} from "../db/schema.js";
import type { Env } from "../env.js";
import { badRequest, conflict, notFound } from "../lib/http-errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const localPhone = (phone: string): string =>
  phone.startsWith("98") ? `0${phone.slice(2)}` : phone;

const loginIdentifierHash = (env: Env, value: string): string =>
  createHmac("sha256", env.OTP_PEPPER)
    .update(`login_identifier\0${value}`)
    .digest("hex");

export async function adminDeleteUser(
  db: Database,
  env: Env,
  id: string,
  confirmation: string,
) {
  if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed user id");
  const typed = confirmation.trim();
  if (!typed) throw badRequest("delete_confirmation_required", "Deletion confirmation is required");

  return db.transaction(async (tx) => {
    // The row lock also blocks new FK-backed payment inserts while deletion is
    // being decided, so the open-payment check below cannot race a new checkout.
    const locked = await tx.execute(sql`
      select id, phone, username
        from users
       where id = ${id}::uuid
       for update
    `);
    const [user] = rowsOf<{ id: string; phone: string; username: string | null }>(locked);
    if (!user) throw notFound("unknown_user", "No such user");

    const expected = user.username ?? localPhone(user.phone);
    if (typed !== expected) {
      throw badRequest(
        "delete_confirmation_mismatch",
        user.username
          ? "Type the exact username to confirm deletion"
          : "This account has no username; type the exact phone number to confirm deletion",
      );
    }

    // Never orphan a checkout that may still move money. Historical terminal
    // rows are safe to retain; an in-flight row must settle/cancel first.
    const openPayment = await tx.execute(sql`
      select 1
        from payments
       where user_id = ${user.id}::uuid
         and applied_at is null
         and status not in ('failed', 'canceled', 'verify_failed')
       limit 1
    `);
    if (rowsOf(openPayment).length) {
      throw conflict(
        "payment_in_progress",
        "This account has an unsettled payment. Resolve it before deleting the account.",
      );
    }

    // App/account data is personal and is removed. Payment rows are NOT deleted:
    // production has an ON DELETE SET NULL FK, so the financial ledger survives
    // without retaining a link to the deleted user.
    await tx.delete(feedback).where(eq(feedback.userId, user.id));
    await tx.delete(redemptions).where(eq(redemptions.userId, user.id));
    await tx.delete(otpCodes).where(eq(otpCodes.phone, user.phone));

    // Login failure buckets contain HMACs rather than raw identifiers, but they
    // are still derived from this account. IP-only buckets stay because an IP
    // may be shared by unrelated users.
    const identifierHashes = [user.phone, user.username]
      .filter((value): value is string => Boolean(value))
      .map((value) => loginIdentifierHash(env, value));
    if (identifierHashes.length) {
      await tx
        .delete(authRateLimitBuckets)
        .where(
          and(
            eq(authRateLimitBuckets.scope, "login_identifier"),
            inArray(authRateLimitBuckets.keyHash, identifierHashes),
          ),
        );
    }

    // records, grants and entitlement cascade. payments are detached by the
    // database FK and remain available as anonymous financial history.
    const deleted = await tx
      .delete(users)
      .where(eq(users.id, user.id))
      .returning();
    if (!deleted.length) throw notFound("unknown_user", "No such user");

    // A phone-restricted discount is PII too. If its code is referenced by
    // preserved payment history, keep the code but scrub the phone and disable
    // it. Otherwise delete the unused private code entirely.
    await tx.execute(sql`
      delete from discounts d
       where d.phone = ${user.phone}
         and not exists (select 1 from redemptions r where r.code = d.code)
         and not exists (select 1 from payments p where p.discount_code = d.code)
    `);
    await tx.execute(sql`
      update discounts
         set phone = null,
             active = false
       where phone = ${user.phone}
    `);

    return {
      ok: true as const,
      deletedUserId: user.id,
      username: user.username,
      phone: localPhone(user.phone),
    };
  });
}
