// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import { sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.ts";
import { toAsciiDigits } from "../lib/phone.ts";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

export type AdminUserSort =
  | "name"
  | "activeDays"
  | "lastActiveAt"
  | "syncDataBytes"
  | "syncRecordCount"
  | "subscription"
  | "expiresAt"
  | "createdAt";

export type AdminUserSubscriptionFilter = "all" | "active" | "expired" | "none";

export type AdminUserListOptions = {
  q?: string;
  page?: number;
  limit?: number;
  sort?: string;
  direction?: string;
  subscription?: string;
  minActiveDays?: number;
  maxActiveDays?: number;
  minDataBytes?: number;
  maxDataBytes?: number;
  registeredFrom?: string;
  registeredTo?: string;
  activeFrom?: string;
  activeTo?: string;
  expiresFrom?: string;
  expiresTo?: string;
};

type UserSummaryRow = {
  id: string;
  phone: string;
  username: string | null;
  created_at: Date | string;
  active_days: number | string | bigint;
  last_active_at: Date | string | null;
  sync_record_count: number | string | bigint;
  sync_data_bytes: number | string | bigint;
  plan_id: string | null;
  expires_at: Date | string | null;
};

const SORTS = new Set<AdminUserSort>([
  "name",
  "activeDays",
  "lastActiveAt",
  "syncDataBytes",
  "syncRecordCount",
  "subscription",
  "expiresAt",
  "createdAt",
]);

const asDate = (value: Date | string | null | undefined): Date | null =>
  value == null ? null : value instanceof Date ? value : new Date(value);

const nonnegativeMetric = (value: number | string | bigint | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const positiveInt = (value: number | undefined, fallback: number, max: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value!), 1), max);
};

const optionalNonnegative = (value: number | undefined): number | null => {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value!));
};

const optionalDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const normalizeSort = (value: string | undefined): AdminUserSort =>
  SORTS.has(value as AdminUserSort) ? (value as AdminUserSort) : "createdAt";

const normalizeSubscription = (value: string | undefined): AdminUserSubscriptionFilter =>
  value === "active" || value === "expired" || value === "none" ? value : "all";

function userSortExpression(sort: AdminUserSort, now: Date) {
  switch (sort) {
    case "name":
      return sql`lower(coalesce(u.username, u.phone))`;
    case "activeDays":
      return sql`coalesce(u.active_days, 0)`;
    case "lastActiveAt":
      return sql`u.last_active_at`;
    case "syncDataBytes":
      return sql`coalesce(u.sync_data_bytes, 0)`;
    case "syncRecordCount":
      return sql`coalesce(u.sync_record_count, 0)`;
    case "subscription":
      return sql`case
        when e.expires_at > ${now.toISOString()}::timestamptz then 2
        when e.expires_at is not null then 1
        else 0
      end`;
    case "expiresAt":
      return sql`e.expires_at`;
    case "createdAt":
    default:
      return sql`u.created_at`;
  }
}

/**
 * Admin-only user browser. Pagination, filtering and ordering all happen in SQL,
 * so the panel never sorts just the first N rows and mistakes that slice for the
 * whole user base.
 */
export async function adminListUsersPage(db: Database, opts: AdminUserListOptions, now: Date) {
  const requestedPage = positiveInt(opts.page, 1, 1_000_000);
  const pageSize = positiveInt(opts.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const sort = normalizeSort(opts.sort);
  const direction = opts.direction === "asc" ? "asc" : "desc";
  const subscription = normalizeSubscription(opts.subscription);

  const query = opts.q?.trim().toLowerCase() ?? "";
  let digits = toAsciiDigits(query).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);

  const minActiveDays = optionalNonnegative(opts.minActiveDays);
  const maxActiveDays = optionalNonnegative(opts.maxActiveDays);
  const minDataBytes = optionalNonnegative(opts.minDataBytes);
  const maxDataBytes = optionalNonnegative(opts.maxDataBytes);
  const registeredFrom = optionalDate(opts.registeredFrom);
  const registeredTo = optionalDate(opts.registeredTo);
  const activeFrom = optionalDate(opts.activeFrom);
  const activeTo = optionalDate(opts.activeTo);
  const expiresFrom = optionalDate(opts.expiresFrom);
  const expiresTo = optionalDate(opts.expiresTo);
  const nowIso = now.toISOString();

  const filters = sql`
    where (
      ${query === ""}
      or lower(coalesce(u.username, '')) like ${`%${query}%`}
      or (${digits !== ""} and u.phone like ${`%${digits}%`})
    )
    and (
      ${subscription === "all"}
      or (${subscription === "active"} and e.expires_at > ${nowIso}::timestamptz)
      or (${subscription === "expired"} and e.expires_at is not null and e.expires_at <= ${nowIso}::timestamptz)
      or (${subscription === "none"} and e.expires_at is null)
    )
    and (${minActiveDays === null} or coalesce(u.active_days, 0) >= ${minActiveDays})
    and (${maxActiveDays === null} or coalesce(u.active_days, 0) <= ${maxActiveDays})
    and (${minDataBytes === null} or coalesce(u.sync_data_bytes, 0) >= ${minDataBytes})
    and (${maxDataBytes === null} or coalesce(u.sync_data_bytes, 0) <= ${maxDataBytes})
    and (${registeredFrom === null} or u.created_at >= ${registeredFrom?.toISOString() ?? null}::timestamptz)
    and (${registeredTo === null} or u.created_at <= ${registeredTo?.toISOString() ?? null}::timestamptz)
    and (${activeFrom === null} or u.last_active_at >= ${activeFrom?.toISOString() ?? null}::timestamptz)
    and (${activeTo === null} or u.last_active_at <= ${activeTo?.toISOString() ?? null}::timestamptz)
    and (${expiresFrom === null} or e.expires_at >= ${expiresFrom?.toISOString() ?? null}::timestamptz)
    and (${expiresTo === null} or e.expires_at <= ${expiresTo?.toISOString() ?? null}::timestamptz)
  `;

  const countResult = await db.execute(sql`
    select count(*) as total
      from users u
      left join entitlements e on e.user_id = u.id
      ${filters}
  `);
  const total = Number(rowsOf<{ total: number | string | bigint }>(countResult)[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const sortExpression = userSortExpression(sort, now);
  const ordering =
    direction === "asc"
      ? sql`${sortExpression} asc nulls last, u.id asc`
      : sql`${sortExpression} desc nulls last, u.id desc`;

  const result = await db.execute(sql`
    select u.id, u.phone, u.username, u.created_at,
           u.active_days, u.last_active_at,
           u.sync_record_count, u.sync_data_bytes,
           e.plan_id, e.expires_at
      from users u
      left join entitlements e on e.user_id = u.id
      ${filters}
     order by ${ordering}
     limit ${pageSize}
    offset ${offset}
  `);

  const users = rowsOf<UserSummaryRow>(result).map((row) => {
    const expiresAt = asDate(row.expires_at);
    const subscriptionActive = !!expiresAt && expiresAt > now;
    return {
      id: row.id,
      phone: row.phone,
      username: row.username,
      createdAt: asDate(row.created_at),
      activeDays: nonnegativeMetric(row.active_days),
      lastActiveAt: asDate(row.last_active_at),
      syncRecordCount: nonnegativeMetric(row.sync_record_count),
      syncDataBytes: nonnegativeMetric(row.sync_data_bytes),
      planId: row.plan_id,
      expiresAt,
      subscriptionActive,
      subscriptionStatus: subscriptionActive ? "active" : expiresAt ? "expired" : "none",
    };
  });

  return {
    users,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
    sort: { key: sort, direction },
  };
}
