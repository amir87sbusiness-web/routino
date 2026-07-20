/**
 * Postgres schema.
 *
 * Two shapes live here on purpose:
 *  - `records` — one generic jsonb table for everything the client syncs. The
 *    client is its only consumer and already owns the types, so a new habit
 *    field needs no migration here. One table means one query, one upsert, one
 *    index — instead of eight of each with identical semantics.
 *  - Everything else — real relational tables, because the server reasons about
 *    them (money, entitlement, rate limits) and needs constraints.
 */
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Entity kinds the client may sync. `feedback` is deliberately absent: it is
 * push-only and lands in its own relational table, so letting it into `records`
 * would round-trip it back to the device and re-dirty it forever. */
export const SYNC_KINDS = ["categories", "habits", "logs", "tasks", "timerSessions", "journal", "settings"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Canonical `989xxxxxxxxx`. MUST be produced by the same normalizePhone as
   * the client — a divergence forks one human into two accounts. */
  phone: text("phone").notNull().unique(),
  /**
   * Per-user monotonic change counter. Incremented with
   * `UPDATE users SET seq = seq + $n ... RETURNING seq`, which takes a row lock
   * and thereby serialises this user's writes — guaranteeing seq order matches
   * commit order. A plain SEQUENCE cannot: a slower txn can grab a lower seq and
   * commit AFTER a reader has already advanced past it, hiding that row from
   * that device forever.
   */
  seq: bigint("seq", { mode: "number" }).notNull().default(0),
  /** Watermark for tombstone GC. A device whose cursor is below this may have
   * missed a tombstone that has since been purged, so it must full-resync or it
   * would resurrect deleted records. */
  gcSeq: bigint("gc_seq", { mode: "number" }).notNull().default(0),
  blocked: boolean("blocked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const records = pgTable(
  "records",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** Client-generated: `uid()`, or a natural composite (`habitId|dateKey`,
     * `dateKey`, or a settings field name). Validated against a strict pattern
     * on push — a malicious client must not be able to send a 10MB id. */
    id: text("id").notNull(),
    data: jsonb("data"),
    /** Client clock, CLAMPED on write to `min(client, serverNow + 60s)`. The LWW
     * key. Unclamped, one device with its clock set to 2099 wins every conflict
     * on this account forever and no amount of correct client code recovers it. */
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    deleted: boolean("deleted").notNull().default(false),
    seq: bigint("seq", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.id] }),
    // The hot path: `WHERE user_id = $1 AND seq > $cursor ORDER BY seq`.
    index("records_pull").on(t.userId, t.seq),
    check("records_kind_valid", sql`${t.kind} IN ('categories','habits','logs','tasks','timerSessions','journal','settings')`),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256 of the refresh token. Never store the token itself. */
    refreshHash: text("refresh_hash").notNull(),
    name: text("name"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("devices_user").on(t.userId)],
);

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    /** sha256(code + pepper). The plaintext code is never stored and never logged. */
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("otp_phone_recent").on(t.phone, t.createdAt), index("otp_ip_recent").on(t.ip, t.createdAt)],
);

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  nameFa: text("name_fa").notNull(),
  nameEn: text("name_en").notNull(),
  months: integer("months").notNull(),
  /** Toman. Rial conversion (×10) happens only at the PSP boundary. */
  priceToman: integer("price_toman").notNull(),
  active: boolean("active").notNull().default(true),
});

export const discounts = pgTable("discounts", {
  code: text("code").primaryKey(),
  percent: integer("percent").notNull(),
  /** Restrict to one user's phone, optional. */
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  /** A code reaches Telegram within a week of launch. These are not optional. */
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

/** One redemption per user per code, enforced by the composite PK. */
export const redemptions = pgTable(
  "redemptions",
  {
    code: text("code")
      .notNull()
      .references(() => discounts.code),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.code, t.userId] })],
);

export const payments = pgTable(
  "payments",
  {
    /** Also the `orderId` sent to the PSP. */
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    planId: text("plan_id").notNull(),
    months: integer("months").notNull(),
    /** Server-computed, post-discount. NEVER accepted from the client. */
    amountToman: integer("amount_toman").notNull(),
    /** Stored rather than derived, so a future price change cannot silently
     * re-price payment history. */
    amountRial: bigint("amount_rial", { mode: "number" }).notNull(),
    discountCode: text("discount_code"),
    discountPercent: integer("discount_percent"),
    offerPercent: integer("offer_percent"),
    /** pending | redirected | paid | failed | canceled | verify_failed */
    status: text("status").notNull().default("pending"),
    /** web | android | ios — decides where the callback page sends the user
     * back to (web URL vs custom-scheme deep link). */
    platform: text("platform"),
    /** Which gateway took this payment (fake | zibal | zarinpal). Null until the
     * checkout registers it with a gateway. Verify/callback route back to this. */
    provider: text("provider"),
    /** Numeric gateway token for zibal/fake (Zibal's trackId). Null for zarinpal,
     * which identifies transactions by the string `authority` below. */
    trackId: bigint("track_id", { mode: "number" }).unique(),
    /** ZarinPal's 36-char string transaction token. Null for numeric gateways. */
    authority: text("authority").unique(),
    refNumber: text("ref_number"),
    cardNumber: text("card_number"),
    pspResult: integer("psp_result"),
    pspStatus: integer("psp_status"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /**
     * Set in the same transaction that grants entitlement. The guard
     * `UPDATE ... WHERE id=$1 AND applied_at IS NULL` makes double-granting
     * structurally impossible, however many times the callback fires.
     */
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_user").on(t.userId), index("payments_status").on(t.status, t.createdAt)],
);

/**
 * Append-only ledger of every entitlement grant, with its source and the payment
 * that caused it. You WILL get "I paid and I don't have access"; this is the
 * difference between a two-minute answer and archaeology.
 */
export const grants = pgTable(
  "grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Plans are sold in months; the trial is 7 days. Both units are recorded
     * rather than approximating one with the other — a "1 Year" plan must mean
     * 12 real months, not 360 days, which is what the old client did. */
    months: integer("months").notNull().default(0),
    days: integer("days").notNull().default(0),
    /** trial | payment | migration | admin */
    source: text("source").notNull(),
    paymentId: uuid("payment_id"),
    /** Free-text audit trail. For `migration` this holds the raw value the
     * client claimed, which is inherently untrusted and worth keeping. */
    note: text("note"),
    /** What the grant actually did, so the ledger can be read without replaying
     * business logic. This is the difference between answering "why do I not
     * have access?" in two minutes and doing archaeology. */
    expiresBefore: timestamp("expires_before", { withTimezone: true }),
    expiresAfter: timestamp("expires_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("grants_user").on(t.userId)],
);

/** Materialized current entitlement. `services/entitlement.ts` is its only writer. */
export const entitlements = pgTable("entitlements", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  rating: integer("rating").notNull(),
  section: text("section"),
  comment: text("comment"),
  at: timestamp("at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const admins = pgTable("admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("admin"),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  devices: many(devices),
  records: many(records),
  grants: many(grants),
  entitlement: one(entitlements),
}));

export const schema = {
  users,
  records,
  devices,
  otpCodes,
  plans,
  discounts,
  redemptions,
  payments,
  grants,
  entitlements,
  feedback,
  admins,
  usersRelations,
};
