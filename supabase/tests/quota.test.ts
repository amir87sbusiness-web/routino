/**
 * Supabase budget guard for the local-first launch architecture.
 *
 * Personal habits, tasks, logs, journal text and settings are device-only. The
 * server budget therefore contains account/device/security/subscription rows,
 * rolling auth ledgers, and small API responses — never a user's content.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, makeHarness, type Harness } from "./helpers/harness.ts";

const FREE_DB_BYTES = 500 * 1024 * 1024;
const FREE_EGRESS_BYTES = 5 * 1024 * 1024 * 1024;
const FREE_FUNCTION_INVOCATIONS = 500_000;
const USERS = 120;
const HALF = USERS / 2;
const PAYING = 36;

const PERMANENT = [
  "users",
  "devices",
  "device_security_events",
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
  return (await login.json()) as { access: string; refresh: string };
}

async function buyPlan(access: string) {
  const checkout = await record(
    "POST /v1/payments/checkout",
    await h.call("POST", "/v1/payments/checkout", {
      headers: auth(access),
      body: { planId: "m1", platform: "web" },
    }),
  );
  const payment = (await checkout.json()) as { paymentId: string; trackId: number };
  const settle = await h.call(
    "GET",
    `/v1/dev/gateway/settle?trackId=${payment.trackId}&outcome=paid`,
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
  h = await makeHarness({ LEGACY_PERSONAL_SYNC_ENABLED: "false" });
  for (let index = 0; index < USERS; index += 1) {
    if (index === HALF) await measure(sizesAtHalf);
    const session = await signUp(index);
    const refresh = await record(
      "POST /v1/auth/token/refresh",
      await h.call("POST", "/v1/auth/token/refresh", { body: { refresh: session.refresh } }),
    );
    const rotated = (await refresh.json()) as { access: string };
    sampleAccess = rotated.access;
    await record(
      "GET /v1/devices/ping",
      await h.call("GET", "/v1/devices/ping", { headers: auth(rotated.access) }),
    );
    await record(
      "GET /v1/subscriptions/me",
      await h.call("GET", "/v1/subscriptions/me", { headers: auth(rotated.access) }),
    );
    if (index < PAYING) await buyPlan(rotated.access);
  }
  await record("GET /v1/plans", await h.call("GET", "/v1/plans"));
  await measure(sizes);
}, 300_000);

afterAll(async () => h?.close());

const sum = (tables: readonly string[], source = sizes) =>
  tables.reduce((total, table) => total + (source.get(table) ?? 0), 0);

describe("local-first database budget", () => {
  it("stores no personal app records and retires both sync directions", async () => {
    const [records] = await h.query<{ n: string }>("select count(*)::text as n from records");
    expect(Number(records.n)).toBe(0);
    const pull = await h.call("GET", "/v1/sync/pull", { headers: auth(sampleAccess) });
    const push = await h.call("POST", "/v1/sync/push", {
      headers: auth(sampleAccess),
      body: { records: [] },
    });
    expect(pull.status).toBe(410);
    expect(push.status).toBe(410);
  });

  it("keeps permanent account/device/subscription rows comfortably bounded", () => {
    const marginal = (sum(PERMANENT) - sum(PERMANENT, sizesAtHalf)) / (USERS - HALF);
    const capacity = Math.floor(FREE_DB_BYTES / marginal);
    console.log(
      `[db] account-only marginal cost ≈ ${Math.round(marginal)} B/user; 500 MB ≈ ${capacity.toLocaleString("en-US")} users`,
    );
    expect(marginal).toBeLessThan(16 * 1024);
    expect(capacity).toBeGreaterThan(30_000);
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
    const visibleHourBytes =
      60 * (responseBytes.get("GET /v1/devices/ping") ?? 0) +
      (responseBytes.get("GET /v1/subscriptions/me") ?? 0) +
      (responseBytes.get("POST /v1/auth/token/refresh") ?? 0);
    const monthlyDau = Math.floor(FREE_EGRESS_BYTES / (visibleHourBytes * 30));
    console.log(`[egress] one visible hour/day ≈ ${visibleHourBytes} B; 5 GB ≈ ${monthlyDau} DAU`);
    expect(monthlyDau).toBeGreaterThan(50_000);
  });

  it("reports the binding function-invocation ceiling honestly", () => {
    // Per visible hour: 60 security pings, one entitlement read, and at most
    // one token refresh. Plans, /health and OPTIONS are served by Cloudflare.
    const dailyInvocations = 62;
    const monthlyDau = Math.floor(FREE_FUNCTION_INVOCATIONS / (dailyInvocations * 30));
    console.log(
      `[invocations] one visible hour/day ≈ ${dailyInvocations} calls; free tier ≈ ${monthlyDau} DAU`,
    );
    expect(monthlyDau).toBeGreaterThan(250);
  });
});
