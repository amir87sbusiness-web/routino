/**
 * Owner bootstrap — makes a known account usable from a fresh deploy.
 *
 * When OWNER_PHONE + OWNER_PASSWORD are set, ensures that account exists with a
 * password, an optional username, and an active entitlement, so the app's owner
 * can sign in with a password on day one — before SMS is live and without any
 * manual SQL. Runs on every boot and is fully idempotent.
 *
 * The one rule that matters: it NEVER overwrites a password that is already set.
 * Once the owner (or anyone) has a password — whether from here, the admin
 * panel, or the app's settings — this leaves it alone, so changing the password
 * in the app is not silently reverted on the next restart.
 */
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import { users } from "../db/schema.js";
import { normalizePhone } from "../lib/phone.js";
import { grantInterval, readEntitlement } from "./entitlement.js";
import { hashPassword, validatePassword, validateUsername } from "./password.js";

type Logger = { info: (msg: string) => void; warn: (msg: string) => void };
const noopLog: Logger = { info: () => {}, warn: () => {} };

export async function ensureOwner(
  db: Database,
  env: Env,
  now: Date,
  log: Logger = noopLog,
): Promise<void> {
  if (!env.OWNER_PHONE || !env.OWNER_PASSWORD) return;

  const phone = normalizePhone(env.OWNER_PHONE);
  if (!phone) {
    log.warn("owner bootstrap skipped: OWNER_PHONE is not a valid Iranian mobile number");
    return;
  }
  if (!validatePassword(env.OWNER_PASSWORD).ok) {
    log.warn(
      "owner bootstrap skipped: OWNER_PASSWORD is too weak (need 8+ chars with a letter and a digit)",
    );
    return;
  }

  let [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (!user) {
    [user] = await db.insert(users).values({ phone, createdAt: now }).returning();
    log.info(`owner bootstrap: created account for ${phone}`);
  }
  if (!user) throw new Error("owner bootstrap: failed to create user");

  const patch: { passwordHash?: string; username?: string } = {};

  // Only ever SET a missing password — never overwrite one already chosen.
  if (!user.passwordHash) patch.passwordHash = await hashPassword(env.OWNER_PASSWORD);

  if (env.OWNER_USERNAME && !user.username) {
    const v = validateUsername(env.OWNER_USERNAME);
    if (v.ok) {
      const [taken] = await db.select().from(users).where(eq(users.username, v.value)).limit(1);
      if (!taken || taken.id === user.id) patch.username = v.value;
      else log.warn(`owner bootstrap: username "${v.value}" already taken, leaving it unset`);
    } else {
      log.warn("owner bootstrap: OWNER_USERNAME is invalid, leaving it unset");
    }
  }

  if (Object.keys(patch).length) {
    await db.update(users).set(patch).where(eq(users.id, user.id));
    if (patch.passwordHash) log.info(`owner bootstrap: set initial password for ${phone}`);
  }

  // Make the app usable: give a long entitlement if the account has none active.
  const ent = await readEntitlement(db, user.id, now);
  if (ent.status !== "active") {
    await grantInterval(
      db,
      user.id,
      { planId: "owner", months: 12, source: "admin", note: "owner bootstrap" },
      now,
    );
    log.info(`owner bootstrap: granted 12-month owner access to ${phone}`);
  }
}
