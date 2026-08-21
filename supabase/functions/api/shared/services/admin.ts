// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
/**
 * Admin read/write queries — framework-free and shared verbatim with the edge
 * function (so the Fastify route and the Hono route can never drift, and both
 * get the same optimisations). The route adapters only do auth + zod parsing.
 *
 * Performance: the dashboard's overview fans out seven independent counts in a
 * single `Promise.all`, so the panel's landing query is one round-trip's worth
 * of latency instead of seven. The per-user detail view does the same.
 */
import { and, count, desc, eq, gt, ilike, sql } from "drizzle-orm";
import type { Database } from "../db/client.ts";
import {
  devices,
  discounts,
  entitlements,
  grants,
  otpCodes,
  payments,
  users,
} from "../db/schema.ts";
import { badRequest, notFound } from "../lib/http-errors.ts";
import { normalizePhone, toAsciiDigits } from "../lib/phone.ts";
import { grantInterval, listGrants, readEntitlement } from "./entitlement.ts";
import { hashPassword, validatePassword } from "./password.ts";
import { revokeAllDevices } from "./tokens.ts";

const DAY_MS = 86_400_000;

export async function adminOverview(db: Database, now: Date) {
  const dayAgo = new Date(now.getTime() - DAY_MS);

  // All independent — one parallel batch, not seven serial round-trips.
  const [totalUsers, newUsers, activeSubs, paid, paidToday, otpToday, verifyFailed, pending] =
    await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(users).where(gt(users.createdAt, dayAgo)),
      db.select({ n: count() }).from(entitlements).where(gt(entitlements.expiresAt, now)),
      db
        .select({ n: count(), revenue: sql<string>`coalesce(sum(${payments.amountToman}), 0)` })
        .from(payments)
        .where(eq(payments.status, "paid")),
      db
        .select({ n: count(), revenue: sql<string>`coalesce(sum(${payments.amountToman}), 0)` })
        .from(payments)
        .where(and(eq(payments.status, "paid"), gt(payments.createdAt, dayAgo))),
      db.select({ n: count() }).from(otpCodes).where(gt(otpCodes.createdAt, dayAgo)),
      // verify_failed = amount mismatch; must never happen. Surfaced loudly.
      db.select({ n: count() }).from(payments).where(eq(payments.status, "verify_failed")),
      db.select({ n: count() }).from(payments).where(eq(payments.status, "redirected")),
    ]);

  return {
    users: { total: totalUsers[0]?.n ?? 0, last24h: newUsers[0]?.n ?? 0 },
    activeSubscriptions: activeSubs[0]?.n ?? 0,
    payments: {
      paidTotal: paid[0]?.n ?? 0,
      revenueToman: Number(paid[0]?.revenue ?? 0),
      paidLast24h: paidToday[0]?.n ?? 0,
      revenueTomanLast24h: Number(paidToday[0]?.revenue ?? 0),
      pending: pending[0]?.n ?? 0,
    },
    alerts: { verifyFailed: verifyFailed[0]?.n ?? 0 },
    otpSentLast24h: otpToday[0]?.n ?? 0,
    serverTime: now.toISOString(),
  };
}

export async function adminListUsers(
  db: Database,
  opts: { q?: string; limit?: number },
  now: Date,
) {
  const n = Math.min(opts.limit || 50, 200);

  const base = db
    .select({
      id: users.id,
      phone: users.phone,
      blocked: users.blocked,
      createdAt: users.createdAt,
      planId: entitlements.planId,
      expiresAt: entitlements.expiresAt,
    })
    .from(users)
    .leftJoin(entitlements, eq(entitlements.userId, users.id))
    .orderBy(desc(users.createdAt))
    .limit(n);

  // Humans type `0912…`; the canonical stored form is `98912…`. Dropping the
  // leading zero makes the obvious search work.
  let digits = opts.q ? toAsciiDigits(opts.q).replace(/\D/g, "") : "";
  if (digits.startsWith("0")) digits = digits.slice(1);
  const rows = digits ? await base.where(ilike(users.phone, `%${digits}%`)) : await base;

  return rows.map((r) => ({ ...r, subscriptionActive: !!r.expiresAt && r.expiresAt > now }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function adminUserDetail(db: Database, id: string, now: Date) {
  if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed user id");
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw notFound("unknown_user", "No such user");

  const [userDevices, userPayments, userGrants, entitlement] = await Promise.all([
    db.select().from(devices).where(eq(devices.userId, id)).orderBy(desc(devices.createdAt)),
    db.select().from(payments).where(eq(payments.userId, id)).orderBy(desc(payments.createdAt)),
    listGrants(db, id),
    readEntitlement(db, id, now),
  ]);

  return {
    user: {
      id: user.id,
      phone: user.phone,
      blocked: user.blocked,
      createdAt: user.createdAt,
    },
    entitlement,
    devices: userDevices.map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      browser: d.browser,
      os: d.os,
      lastSeenAt: d.lastSeenAt,
      revokedAt: d.revokedAt,
      revocationReason: d.revocationReason,
      createdAt: d.createdAt,
    })),
    payments: userPayments,
    grants: userGrants,
  };
}

export async function adminSetBlocked(db: Database, id: string, blocked: boolean, now: Date) {
  if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed user id");
  const [user] = await db.update(users).set({ blocked }).where(eq(users.id, id)).returning();
  if (!user) throw notFound("unknown_user", "No such user");
  // Blocking must also kill sessions, or the user keeps access until their
  // refresh token dies of old age.
  if (blocked) await revokeAllDevices(db, id, now);
  return { ok: true as const, blocked: user.blocked };
}

export async function adminGrant(
  db: Database,
  id: string,
  body: { months: number; days: number; planId: string; note?: string | null },
  now: Date,
) {
  if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed user id");
  if (body.months === 0 && body.days === 0)
    throw badRequest("empty_grant", "months or days required");
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw notFound("unknown_user", "No such user");

  const entitlement = await grantInterval(
    db,
    id,
    {
      planId: body.planId,
      months: body.months,
      days: body.days,
      source: "admin",
      note: body.note ?? null,
    },
    now,
  );
  return { ok: true as const, entitlement };
}

/**
 * Sets (or resets) a user's password by phone number, creating the account if it
 * doesn't exist yet. This is how the owner provisions a password-login account
 * from the panel when SMS isn't live — the panel is deliberately usable exactly
 * when OTP is down. Account creation itself grants no access; entitlement is
 * activated or granted through its own explicit business path.
 */
export async function adminSetPassword(
  db: Database,
  body: { phone: string; password: string },
  now: Date,
) {
  const phone = normalizePhone(body.phone);
  if (!phone) throw badRequest("invalid_phone", "Enter a valid Iranian mobile number");
  if (!validatePassword(body.password).ok) {
    throw badRequest(
      "weak_password",
      "Password must be 8+ chars with at least one letter and one digit",
    );
  }

  const passwordHash = await hashPassword(body.password);
  let [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  let created = false;
  if (user) {
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    // This button is what support uses when a user reports someone got into
    // their account, so leaving that someone signed in defeats the whole point:
    // refresh tokens live 180 days and rotate silently. Unlike the user-facing
    // password change there is no caller device to preserve — the admin is
    // acting on someone else's account — so every device goes.
    await revokeAllDevices(db, user.id, now);
  } else {
    [user] = await db.insert(users).values({ phone, passwordHash, createdAt: now }).returning();
    created = true;
    if (!user) throw new Error("failed to create user");
  }

  return { ok: true as const, created, userId: user.id, phone };
}

export async function adminListPayments(db: Database, opts: { status?: string; limit?: number }) {
  const n = Math.min(opts.limit || 50, 200);

  const base = db
    .select({
      id: payments.id,
      phone: users.phone,
      userId: payments.userId,
      planId: payments.planId,
      amountToman: payments.amountToman,
      discountCode: payments.discountCode,
      status: payments.status,
      provider: payments.provider,
      platform: payments.platform,
      trackId: payments.trackId,
      refNumber: payments.refNumber,
      createdAt: payments.createdAt,
      paidAt: payments.paidAt,
    })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.userId))
    .orderBy(desc(payments.createdAt))
    .limit(n);

  return opts.status ? base.where(eq(payments.status, opts.status)) : base;
}

export async function adminListDiscounts(db: Database) {
  return db.select().from(discounts).orderBy(discounts.code);
}

/** The largest instant a JS `Date` can represent; past this it is Invalid Date. */
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

/**
 * Epoch ms -> Date, clamped.
 *
 * `expiresAt` is validated as `z.number().int().positive()`, which still admits
 * values past the largest representable instant. `new Date()` would then yield
 * Invalid Date and the insert would fail with an opaque 500 instead of setting
 * an expiry. Clamping is lossless in meaning: an absurdly distant expiry and the
 * maximum representable one both say "this code never expires".
 */
const toExpiry = (ms: number | null | undefined): Date | null =>
  ms ? new Date(Math.min(ms, MAX_TIMESTAMP_MS)) : null;

export async function adminCreateDiscount(
  db: Database,
  body: {
    code: string;
    percent: number;
    maxUses?: number | null;
    expiresAt?: number | null;
    phone?: string | null;
  },
) {
  const code = body.code.toUpperCase();
  const [existing] = await db.select().from(discounts).where(eq(discounts.code, code)).limit(1);
  if (existing) throw badRequest("duplicate_code", "Code already exists");

  const [row] = await db
    .insert(discounts)
    .values({
      code,
      percent: body.percent,
      maxUses: body.maxUses ?? null,
      expiresAt: toExpiry(body.expiresAt),
      phone: body.phone || null,
      active: true,
    })
    .returning();
  return { ok: true as const, discount: row };
}

export async function adminUpdateDiscount(
  db: Database,
  code: string,
  body: { active?: boolean; maxUses?: number | null; expiresAt?: number | null },
) {
  const patch: Record<string, unknown> = {};
  if (body.active !== undefined) patch.active = body.active;
  if (body.maxUses !== undefined) patch.maxUses = body.maxUses;
  if (body.expiresAt !== undefined) patch.expiresAt = toExpiry(body.expiresAt);
  if (!Object.keys(patch).length) throw badRequest("empty_patch", "Nothing to update");

  const [row] = await db
    .update(discounts)
    .set(patch)
    .where(eq(discounts.code, code.toUpperCase()))
    .returning();
  if (!row) throw notFound("unknown_code", "No such discount");
  return { ok: true as const, discount: row };
}
