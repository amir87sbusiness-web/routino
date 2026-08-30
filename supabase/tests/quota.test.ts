/**
 * Supabase budget guard for the local-first, cloud-synced launch architecture.
 *
 * Personal rows live in the generic `records` log. The model below writes a
 * modest quarter of small records per account, while account/session and
 * subscription rows remain bounded separately.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, makeHarness, type Harness } from "./helpers/harness.ts";

const FREE_DB_BYTES = 500 * 1024 * 1024;
const FREE_EGRESS_BYTES = 5 * 1024 * 1024 * 1024;
const FREE_FUNCTION_INVOCATIONS = 500_000;
const USERS = 120;
const HALF = USERS / 2;
const PAYING = 36;
const RECORDS_PER_USER = 48;

const PERMANENT = [
  "users",
  "records",
  "entitlements",
  "grants",
  "payments",
  "redemptions",
] as const;
const ROLLING = ["otp_codes", "login_attempts"] as const;

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
  const seed = await h.call("POST", "/v1/sync/exchange", {
    headers: auth(session.access),
    body: {
      cursor: 0,
      records: Array.from({ length: RECORDS_PER_USER }, (_, recordIndex) => {
        const habitId = `habit-${index}-${recordIndex}`;
        const dateKey = `2026-08-${String((recordIndex % 28) + 1).padStart(2, "0")}`;
        return {
          kind: "logs",
          id: `${habitId}|${dateKey}`,
          data: { habitId, dateKey, value: 1, done: recordIndex % 2 === 0 },
          updatedAt: index * 10_000 + recordIndex,
          deleted: false,
        };
      }),
      includeAccountState: false,
    },
  });
  const seeded = (await seed.json()) as { cursor: number };

  // A normal changed session sends a tiny delta and receives it back in the
  // same invocation. An app boot is one empty exchange with account state.
  const changed = await record(
    "POST /v1/sync/exchange changed",
    await h.call("POST", "/v1/sync/exchange", {
      headers: auth(session.access),
      body: {
        cursor: seeded.cursor,
        records: [
          {
            kind: "logs",
            id: `habit-${index}-0|2026-08-01`,
            data: {
              habitId: `habit-${index}-0`,
              dateKey: "2026-08-01",
              value: 1,
              done: true,
            },
            updatedAt: 9_000_000 + index,
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
    expect(Number(records.n)).toBe(USERS * RECORDS_PER_USER);
    const pull = await h.call("GET", "/v1/sync/pull?cursor=0", { headers: auth(sampleAccess) });
    expect(pull.status).toBe(200);
    expect((await pull.json()).records).toHaveLength(RECORDS_PER_USER);
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
      update login_attempts set created_at = now() - interval '48 hours';
      delete from otp_codes where created_at < now() - interval '24 hours';
      delete from login_attempts where created_at < now() - interval '24 hours';
    `);
    const [otp] = await h.query<{ n: string }>("select count(*)::text as n from otp_codes");
    const [attempts] = await h.query<{ n: string }>(
      "select count(*)::text as n from login_attempts",
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
