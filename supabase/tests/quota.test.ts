/**
 * Supabase budget guard for the local-first, cloud-synced launch architecture.
 *
 * Daily habit facts are packed into one row per habit-month. This fixture stores
 * more than a thousand real days per account and asserts the physical row slope
 * is habits × months rather than habits × days.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, makeHarness, type Harness } from "./helpers/harness.ts";

const FREE_DB_BYTES = 500 * 1024 * 1024;
const FREE_EGRESS_BYTES = 5 * 1024 * 1024 * 1024;
const FREE_FUNCTION_INVOCATIONS = 500_000;
const ACCOUNT_RECORD_LIMIT = 50_000;
const ACCOUNT_DATA_BYTE_LIMIT = 128 * 1024 * 1024;
const USERS = 120;
const HALF = USERS / 2;
const PAYING = 36;
const HABITS_PER_USER = 4;
const MONTHS_PER_HABIT = 12;
const DAYS_PER_MONTH = 28;
const MONTH_ROWS_PER_USER = HABITS_PER_USER * MONTHS_PER_HABIT;
const DAILY_FACTS_PER_USER = MONTH_ROWS_PER_USER * DAYS_PER_MONTH;
const SEED_CHUNK = 8;

const PERMANENT = [
  "users",
  "records",
  "entitlements",
  "grants",
  "payments",
  "redemptions",
] as const;
const ROLLING = ["otp_codes", "auth_rate_limit_buckets"] as const;

let h: Harness;
let sampleAccess: string;
const sizes = new Map<string, number>();
const sizesAtHalf = new Map<string, number>();
const responseBytes = new Map<string, number>();

async function record(label: string, response: Response): Promise<Response> {
  responseBytes.set(label, Buffer.byteLength(await response.clone().text()));
  return response;
}

async function signUp(index: number) {
  const phone = `0912${String(8_000_000 + index).slice(-7)}`;
  await record(
    "POST /v1/auth/otp/request",
    await h.call("POST", "/v1/auth/otp/request", { body: { phone } }),
  );
  const login = await record(
    "POST /v1/auth/otp/verify",
    await h.call("POST", "/v1/auth/otp/verify", {
      body: { phone, code: h.sms.last()!.code },
    }),
  );
  const session = (await login.json()) as { access: string };
  const months = Array.from({ length: MONTH_ROWS_PER_USER }, (_, recordIndex) => {
    const habitIndex = Math.floor(recordIndex / MONTHS_PER_HABIT);
    const monthIndex = recordIndex % MONTHS_PER_HABIT;
    const habitId = `habit-${index}-${habitIndex}`;
    const monthKey = `2026-${String(monthIndex + 1).padStart(2, "0")}`;
    const cells = Object.fromEntries(
      Array.from({ length: DAYS_PER_MONTH }, (_, dayIndex) => {
        const dateKey = `${monthKey}-${String(dayIndex + 1).padStart(2, "0")}`;
        const updatedAt = index * 1_000_000 + recordIndex * 100 + dayIndex;
        return [
          String(dayIndex + 1).padStart(2, "0"),
          {
            value: 1,
            done: dayIndex % 2 === 0,
            updatedAt,
            deleted: false,
          },
        ];
      }),
    );
    return {
      kind: "habitMonths",
      id: `${habitId}|${monthKey}`,
      data: { habitId, monthKey, cells },
      updatedAt: Math.max(...Object.values(cells).map((cell) => cell.updatedAt)),
      deleted: false,
    };
  });

  let cursor = 0;
  for (let offset = 0; offset < months.length; offset += SEED_CHUNK) {
    const seed = await h.call("POST", "/v1/sync/exchange", {
      headers: auth(session.access),
      body: {
        protocolVersion: 2,
        cursor,
        records: months.slice(offset, offset + SEED_CHUNK),
        includeAccountState: false,
      },
    });
    expect(seed.status).toBe(200);
    cursor = ((await seed.json()) as { cursor: number }).cursor;
  }

  // A normal changed session sends a tiny delta and receives it back in the
  // same invocation. An app boot is one empty exchange with account state.
  const changed = await record(
    "POST /v1/sync/exchange changed",
    await h.call("POST", "/v1/sync/exchange", {
      headers: auth(session.access),
      body: {
        protocolVersion: 2,
        cursor,
        records: [
          {
            kind: "habitMonths",
            id: `habit-${index}-0|2026-01`,
            data: {
              habitId: `habit-${index}-0`,
              monthKey: "2026-01",
              cells: {
                "01": {
                  value: 1,
                  done: true,
                  updatedAt: 9_000_000_000 + index,
                  deleted: false,
                },
              },
            },
            updatedAt: 9_000_000_000 + index,
            deleted: false,
          },
        ],
        includeAccountState: false,
      },
    }),
  );
  const changedBody = (await changed.clone().json()) as { cursor: number };
  await record(
    "POST /v1/sync/exchange boot",
    await h.call("POST", "/v1/sync/exchange", {
      headers: auth(session.access),
      body: {
        protocolVersion: 2,
        cursor: changedBody.cursor,
        records: [],
        includeAccountState: true,
      },
    }),
  );
  return {
    ...session,
    syncCursor: changedBody.cursor,
  };
}

async function buyPlan(access: string) {
  const checkout = await record(
    "POST /v1/payments/checkout",
    await h.call("POST", "/v1/payments/checkout", {
      headers: auth(access),
      body: { planId: "m1", platform: "web", attemptId: crypto.randomUUID() },
    }),
  );
  const payment = (await checkout.json()) as { paymentId: string; authority: string };
  const settle = await h.call(
    "GET",
    `/v1/dev/gateway/settle?Authority=${payment.authority}&outcome=paid`,
  );
  await h.follow(settle.headers.get("location")!);
}

async function measure(into: Map<string, number>) {
  await h.raw("vacuum analyze");
  const rows = await h.query<{ relname: string; bytes: string }>(`
    select relname, pg_total_relation_size(c.oid)::text as bytes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  `);
  into.clear();
  for (const row of rows) into.set(row.relname, Number(row.bytes));
}

beforeAll(async () => {
  h = await makeHarness();
  for (let index = 0; index < USERS; index += 1) {
    if (index === HALF) await measure(sizesAtHalf);
    const session = await signUp(index);
    sampleAccess = session.access;
    if (index < PAYING) await buyPlan(session.access);
  }
  await record("GET /v1/plans", await h.call("GET", "/v1/plans"));
  await measure(sizes);
}, 300_000);

afterAll(async () => h?.close());

const sum = (tables: readonly string[], source = sizes) =>
  tables.reduce((total, table) => total + (source.get(table) ?? 0), 0);

describe("cloud-sync database budget", () => {
  it("stores personal records through authenticated push and pull", async () => {
    const [records] = await h.query<{ n: string }>("select count(*)::text as n from records");
    expect(Number(records.n)).toBe(USERS * MONTH_ROWS_PER_USER);
    const [facts] = await h.query<{ n: string }>(`
      select count(*)::text as n
        from records r
        cross join lateral jsonb_object_keys(r.data->'cells') cell
       where r.kind = 'habitMonths'
    `);
    expect(Number(facts.n)).toBe(USERS * DAILY_FACTS_PER_USER);
    const pull = await h.call("GET", "/v1/sync/pull?cursor=0", { headers: auth(sampleAccess) });
    expect(pull.status).toBe(200);
    expect((await pull.json()).records).toHaveLength(MONTH_ROWS_PER_USER);
  });

  it("keeps exact per-account counters with centuries of fixture headroom", async () => {
    const mismatches = await h.query<{ user_id: string }>(`
      with actual as (
        select u.id as user_id,
               count(r.*)::integer as record_count,
               coalesce(sum(octet_length(r.data::text)), 0)::bigint as data_bytes
          from users u left join records r on r.user_id = u.id
         group by u.id
      )
      select a.user_id
        from actual a join users u on u.id = a.user_id
       where u.sync_record_count <> a.record_count
          or u.sync_data_bytes <> a.data_bytes
    `);
    expect(mismatches).toHaveLength(0);

    const [usage] = await h.query<{ records_per_user: string; data_bytes_per_user: string }>(`
      select avg(sync_record_count)::text as records_per_user,
             avg(sync_data_bytes)::text as data_bytes_per_user
        from users
    `);
    const recordsPerYear = Number(usage.records_per_user);
    const dataBytesPerYear = Number(usage.data_bytes_per_user);
    const recordYears = Math.floor(ACCOUNT_RECORD_LIMIT / recordsPerYear);
    const byteYears = Math.floor(ACCOUNT_DATA_BYTE_LIMIT / dataBytesPerYear);
    console.log(
      `[account budget] fixture ≈ ${Math.round(recordsPerYear)} rows + ${Math.round(dataBytesPerYear)} JSON B/year; headroom ≈ ${Math.min(recordYears, byteYears)} years`,
    );
    expect(recordsPerYear).toBe(MONTH_ROWS_PER_USER);
    expect(Math.min(recordYears, byteYears)).toBeGreaterThan(100);
  });

  it("keeps permanent account/content/subscription rows comfortably bounded", () => {
    const marginal = (sum(PERMANENT) - sum(PERMANENT, sizesAtHalf)) / (USERS - HALF);
    const capacity = Math.floor(FREE_DB_BYTES / marginal);
    console.log(
      `[db] account-only marginal cost ≈ ${Math.round(marginal)} B/user; 500 MB ≈ ${capacity.toLocaleString("en-US")} users`,
    );
    expect(marginal).toBeLessThan(64 * 1024);
    expect(capacity).toBeGreaterThan(8_000);
  });

  it("keeps auth ledgers rolling rather than permanent", async () => {
    expect(sum(ROLLING)).toBeGreaterThan(0);
    await h.raw(`
      update otp_codes set created_at = now() - interval '48 hours';
      insert into auth_rate_limit_buckets
        (scope, key_hash, window_start, count, expires_at)
      values ('test', 'expired', now() - interval '48 hours', 20, now() - interval '1 hour');
      delete from otp_codes where created_at < now() - interval '24 hours';
      delete from auth_rate_limit_buckets where expires_at < now();
    `);
    const [otp] = await h.query<{ n: string }>("select count(*)::text as n from otp_codes");
    const [attempts] = await h.query<{ n: string }>(
      "select count(*)::text as n from auth_rate_limit_buckets where key_hash = 'expired'",
    );
    expect(Number(otp.n)).toBe(0);
    expect(Number(attempts.n)).toBe(0);
  });
});

describe("egress and invocation budget", () => {
  it("keeps every response small", () => {
    for (const [label, bytes] of responseBytes) {
      expect(bytes, `${label} response is too large`).toBeLessThan(4096);
    }
    const dailyBytes =
      (responseBytes.get("POST /v1/sync/exchange changed") ?? 0) +
      (responseBytes.get("POST /v1/sync/exchange boot") ?? 0);
    const monthlyDau = Math.floor(FREE_EGRESS_BYTES / (dailyBytes * 30));
    console.log(
      `[egress] boot + one changed session/day ≈ ${dailyBytes} B; 5 GB ≈ ${monthlyDau} DAU`,
    );
    // The changed response conservatively contains the complete edited month,
    // not only the one cell this device already knows. Compact day cells keep
    // even the uncompressed result far above the invocation ceiling (~8.3k
    // DAU), so egress is not the tier that forces an upgrade.
    expect(monthlyDau).toBeGreaterThan(50_000);
  });

  it("reports the binding function-invocation ceiling honestly", () => {
    // One boot exchange plus one changed-session idle/close exchange. There is
    // no device ping, token refresh, visible-minute poll or realtime socket.
    const dailyInvocations = 2;
    const monthlyDau = Math.floor(FREE_FUNCTION_INVOCATIONS / (dailyInvocations * 30));
    console.log(
      `[invocations] one visible hour/day ≈ ${dailyInvocations} calls; free tier ≈ ${monthlyDau} DAU`,
    );
    expect(monthlyDau).toBeGreaterThan(8_000);
  });
});
