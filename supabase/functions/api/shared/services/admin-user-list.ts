// AUTO-GENERATED from backend/src — do not edit. Run `node scripts/sync-edge-shared.mjs`.
import { sql } from "drizzle-orm";
import { rowsOf, type Database } from "../db/client.ts";
import { toAsciiDigits } from "../lib/phone.ts";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const CURSOR_MAX_LENGTH = 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
type SortDirection = "asc" | "desc";

type AdminUserCursor = {
  sort: AdminUserSort;
  direction: SortDirection;
  value: string;
  id: string;
};

export type AdminUserListOptions = {
  q?: string;
  cursor?: string;
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
  sort_value: number | string | bigint;
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

function parseCursor(
  raw: string | undefined,
  sort: AdminUserSort,
  direction: SortDirection,
): AdminUserCursor | null {
  if (!raw || raw.length > CURSOR_MAX_LENGTH) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AdminUserCursor>;
    if (
      parsed.sort !== sort ||
      parsed.direction !== direction ||
      typeof parsed.value !== "string" ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id)
    ) {
      return null;
    }
    if (sort === "name") {
      if (parsed.value.length > 256) return null;
    } else if (!/^-?\d+$/.test(parsed.value)) {
      return null;
    }
    return parsed as AdminUserCursor;
  } catch {
    return null;
  }
}

function encodeCursor(
  sort: AdminUserSort,
  direction: SortDirection,
  value: number | string | bigint,
  id: string,
) {
  return JSON.stringify({ sort, direction, value: String(value), id } satisfies AdminUserCursor);
}

function userSortExpression(sort: AdminUserSort, direction: SortDirection, now: Date) {
  switch (sort) {
    case "name":
      return sql`lower(coalesce(u.username, u.phone))`;
    case "activeDays":
      return sql`coalesce(u.active_days, 0)`;
    case "lastActiveAt":
      return direction === "asc"
        ? sql`coalesce((extract(epoch from u.last_active_at) * 1000)::bigint, 9223372036854775807::bigint)`
        : sql`coalesce((extract(epoch from u.last_active_at) * 1000)::bigint, -1::bigint)`;
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
      return direction === "asc"
        ? sql`coalesce((extract(epoch from e.expires_at) * 1000)::bigint, 9223372036854775807::bigint)`
        : sql`coalesce((extract(epoch from e.expires_at) * 1000)::bigint, -1::bigint)`;
    case "createdAt":
    default:
      return sql`(extract(epoch from u.created_at) * 1000)::bigint`;
  }
}

/**
 * Admin-only user browser. Every page is ONE SQL query and reads at most
 * `pageSize + 1` result rows. It deliberately uses the denormalised counters on
 * `users` instead of aggregating `records`, and cursor pagination instead of
 * COUNT/OFFSET so later pages do not get progressively more expensive.
 */
export async function adminListUsersPage(db: Database, opts: AdminUserListOptions, now: Date) {
  const pageSize = positiveInt(opts.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const sort = normalizeSort(opts.sort);
  const direction: SortDirection = opts.direction === "asc" ? "asc" : "desc";
  const subscription = normalizeSubscription(opts.subscription);
  const cursor = parseCursor(opts.cursor, sort, direction);

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
  const sortExpression = userSortExpression(sort, direction, now);

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

  const cursorFilter = !cursor
    ? sql``
    : direction === "asc"
      ? sql`where (sort_value > ${cursor.value} or (sort_value = ${cursor.value} and id > ${cursor.id}::uuid))`
      : sql`where (sort_value < ${cursor.value} or (sort_value = ${cursor.value} and id < ${cursor.id}::uuid))`;
  const ordering =
    direction === "asc" ? sql`sort_value asc, id asc` : sql`sort_value desc, id desc`;

  const result = await db.execute(sql`
    with filtered_users as (
      select u.id, u.phone, u.username, u.created_at,
             u.active_days, u.last_active_at,
             u.sync_record_count, u.sync_data_bytes,
             e.plan_id, e.expires_at,
             ${sortExpression} as sort_value
        from users u
        left join entitlements e on e.user_id = u.id
        ${filters}
    )
    select *
      from filtered_users
      ${cursorFilter}
     order by ${ordering}
     limit ${pageSize + 1}
  `);

  const rows = rowsOf<UserSummaryRow>(result);
  const hasNext = rows.length > pageSize;
  const visibleRows = hasNext ? rows.slice(0, pageSize) : rows;
  const users = visibleRows.map((row) => {
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

  const last = visibleRows.at(-1);
  return {
    users,
    pagination: {
      pageSize,
      hasNext,
      nextCursor:
        hasNext && last ? encodeCursor(sort, direction, last.sort_value, last.id) : null,
    },
    sort: { key: sort, direction },
  };
}
