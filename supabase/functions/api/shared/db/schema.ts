// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Entity kinds the client may sync. `feedback` is deliberately absent: it is
 * push-only and lands in its own relational table, so letting it into `records`
 * would round-trip it back to the device and re-dirty it forever. */
export const SYNC_KINDS = [
  "categories",
  "habits",
  "logs",
  "tasks",
  "timerSessions",
  "journal",
  "settings",
] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Canonical `989xxxxxxxxx`. MUST be produced by the same normalizePhone as
     * the client — a divergence forks one human into two accounts. */
    phone: text("phone").notNull().unique(),
    /** Optional login handle, stored lowercased. Lets a user sign in with a name
     * instead of a phone number. NULL for accounts that never set one; Postgres
     * allows many NULLs under a unique index. Always starts with a letter, so it
     * can never be mistaken for a phone number at login. */
    username: text("username").unique(),
    /** scrypt hash (`scrypt$N$r$p$saltB64$hashB64`), or NULL for OTP-only accounts.
     * The raw password is never stored, logged, or returned. */
    passwordHash: text("password_hash"),
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
    /** Deprecated compatibility column from the retired device quota. No runtime
     * path reads or enforces it; keep it mapped until a reviewed DB migration
     * removes the physical production column. */
    maxActiveDevices: integer("max_active_devices").notNull().default(1),
    securityLockedAt: timestamp("security_locked_at", { withTimezone: true }),
    securityLockReason: text("security_lock_reason"),
    deviceSwitchResetAt: timestamp("device_switch_reset_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("users_max_active_devices_valid", sql`${t.maxActiveDevices} between 1 and 10`)],
);

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
    check(
      "records_kind_valid",
      sql`${t.kind} IN ('categories','habits','logs','tasks','timerSessions','journal','settings')`,
    ),
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
    /** Hash of a random installation key generated on the device. IP/VPN and
     * user-agent changes must never manufacture a new device. */
    installationKeyHash: text("installation_key_hash"),
    name: text("name"),
    platform: text("platform"),
    browser: text("browser"),
    os: text("os"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("devices_user").on(t.userId),
    uniqueIndex("devices_installation").on(t.userId, t.installationKeyHash),
  ],
);

export const deviceSecurityEvents = pgTable(
  "device_security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    replacedDeviceId: uuid("replaced_device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("device_security_events_user_time").on(t.userId, t.createdAt)],
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
  (t) => [
    index("otp_phone_recent").on(t.phone, t.createdAt),
    index("otp_ip_recent").on(t.ip, t.createdAt),
  ],
);

/**
 * Failed-login ledger — the rate-limit state for password sign-in, mirroring how
 * `otp_codes` backs the OTP limits. In Postgres, not memory: it must survive
 * restarts and work across multiple isolates. Only failures are recorded; a
 * correct password clears the identifier's recent rows. `identifier` is the
 * canonical lookup key (a `989…` phone or a lowercased username), so the two
 * ways of typing one phone throttle as one account.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ip: text("ip"),
    identifier: text("identifier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("login_attempts_identifier").on(t.identifier, t.createdAt),
    index("login_attempts_ip").on(t.ip, t.createdAt),
  ],
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
    /** Client-generated idempotency key. It identifies one checkout intent for
     * one user; retries with the same key must never register twice at a PSP. */
    attemptId: uuid("attempt_id"),
    /** Which gateway took this payment (fake | zibal | zarinpal). Null until the
     * checkout registers it with a gateway. Verify/callback route back to this. */
    provider: text("provider"),
    /** Opaque PSP transaction identifier. Its uniqueness is scoped by provider:
     * two gateways may legitimately issue the same reference. */
    providerRef: text("provider_ref"),
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
  (t) => [
    index("payments_user").on(t.userId),
    index("payments_status").on(t.status, t.createdAt),
    uniqueIndex("payments_user_attempt_unique")
      .on(t.userId, t.attemptId)
      .where(sql`${t.attemptId} is not null`),
    uniqueIndex("payments_provider_ref_unique")
      .on(t.provider, t.providerRef)
      .where(sql`${t.providerRef} is not null`),
  ],
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
  (t) => [
    index("grants_user").on(t.userId),
    uniqueIndex("grants_payment_id_unique")
      .on(t.paymentId)
      .where(sql`${t.paymentId} is not null`),
  ],
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
  deviceSecurityEvents,
  otpCodes,
  loginAttempts,
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
