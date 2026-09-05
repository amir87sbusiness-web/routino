// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * Permanent account deletion initiated from the owner-only admin panel.
 *
 * This is intentionally separate from ordinary account-retention cleanup:
 * admin deletion is explicit, immediate and destructive. The target user row is
 * locked first so concurrent sync/payment work cannot race a half-deleted
 * account. Everything identifiable to the account is removed in one transaction;
 * if any statement fails, PostgreSQL rolls the whole deletion back.
 */
import { createHmac } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.ts";
import {
  authRateLimitBuckets,
  feedback,
  otpCodes,
  payments,
  redemptions,
  users,
} from "../db/schema.ts";
import type { Env } from "../env.ts";
import { badRequest, notFound } from "../lib/http-errors.ts";

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

    await tx.delete(feedback).where(eq(feedback.userId, user.id));
    await tx.delete(redemptions).where(eq(redemptions.userId, user.id));
    await tx.delete(payments).where(eq(payments.userId, user.id));
    await tx.delete(otpCodes).where(eq(otpCodes.phone, user.phone));

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

    const deleted = await tx
      .delete(users)
      .where(eq(users.id, user.id))
      .returning({ id: users.id });
    if (!deleted.length) throw notFound("unknown_user", "No such user");

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
