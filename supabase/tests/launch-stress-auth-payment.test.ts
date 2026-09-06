/** Opt-in, synthetic LOCAL PostgreSQL audit. Never points at deployed services. */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { buildApp } from "../functions/api/app.ts";
import type { Database } from "../functions/api/shared/db/client.ts";
import { SCHEMA_SQL } from "../functions/api/shared/db/ddl.ts";
import { schema } from "../functions/api/shared/db/schema.ts";
import { loadEnv } from "../functions/api/shared/env.ts";
import { fakePsp } from "../functions/api/shared/providers/psp/fake.ts";
import type { PspProvider } from "../functions/api/shared/providers/psp/index.ts";
import { hashPassword } from "../functions/api/shared/services/password.ts";
import { claimSendSlot } from "../functions/api/shared/services/otp.ts";
import { issueAccessToken } from "../functions/api/shared/services/tokens.ts";

const enabled = process.env.ROUTINO_LOCAL_AUTH_PAYMENT_AUDIT === "1";
const test = enabled ? it : it.skip;
const url = "postgresql://routino_audit@127.0.0.1:55436/auth_payment_audit";
const out = resolve("artifacts/launch-audit-2026-09-06");
const records: Record<string, unknown>[] = [];
let client: ReturnType<typeof postgres>;
let db: Database;
let app: ReturnType<typeof buildApp>;
let queryCount = 0;
let clockMs = Date.now();
let passwordHash = "";
let smsDelay = 0;
let requestDelay = 0;
let verifyDelay = 0;
let smsActive = 0;
let smsPeak = 0;
let requestActive = 0;
let requestPeak = 0;
let verifyActive = 0;
let verifyPeak = 0;
let requests = 0;
let verifies = 0;
let smsFailure = false;
let requestOutcome: "issued" | "mixed" | "unknown" = "issued";
let verifyOutcome: "normal" | "unknown" = "normal";
let sent: { phone: string; code: string }[] = [];
let fake = fakePsp("http://audit.invalid");
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const env = loadEnv({
  NODE_ENV: "test", DATABASE_URL: url, DB_DRIVER: "postgres", SMS_PROVIDER: "console",
  PSP_PROVIDER: "fake", PROXY_SECRET: "", JWT_SECRET: "local-audit-jwt-value-".repeat(3),
  OTP_PEPPER: "local-audit-otp-value-".repeat(3), ADMIN_PHONE: "09120000123",
  ADMIN_SESSION_SECRET: "local-audit-admin-".repeat(3),
  PUBLIC_API_URL: "http://audit.invalid", PUBLIC_WEB_URL: "http://audit.invalid/app",
});
const provider: PspProvider = {
  name: "fake",
  startUrl: (authority) => fake.startUrl(authority),
  async request(input) {
    const number = requests++;
    requestPeak = Math.max(requestPeak, ++requestActive);
    try {
      if (requestDelay) await delay(requestDelay);
      if (requestOutcome === "unknown" || (requestOutcome === "mixed" && number % 4 === 0))
        return { kind: "unknown" };
      if (requestOutcome === "mixed" && number % 4 === 1) return { kind: "rejected", code: -9 };
      return fake.request(input);
    } finally { requestActive--; }
  },
  async verify(authority, amount) {
    verifies++;
    verifyPeak = Math.max(verifyPeak, ++verifyActive);
    try {
      if (verifyDelay) await delay(verifyDelay);
      if (verifyOutcome === "unknown") return { kind: "unknown" };
      return fake.verify(authority, amount);
    } finally { verifyActive--; }
  },
};

function connect(max: number) {
  client = postgres(url, { prepare: false, max, idle_timeout: 5, connect_timeout: 5 });
  db = drizzle(client, {
    schema,
    logger: { logQuery() { queryCount++; } },
  }) as unknown as Database;
  app = buildApp({
    db, env, psp: provider, now: () => clockMs,
    sms: { async sendOtp(phone, code) {
      smsPeak = Math.max(smsPeak, ++smsActive);
      try {
        sent.push({ phone, code });
        if (smsDelay) await delay(smsDelay);
        if (smsFailure) throw new Error("synthetic ambiguous SMS timeout");
      } finally { smsActive--; }
    } },
  });
}

beforeAll(async () => {
  if (!enabled) return;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  connect(2);
  await client.unsafe(SCHEMA_SQL).simple();
  passwordHash = await hashPassword("Synthetic!2026");
}, 60_000);

afterAll(async () => {
  if (!enabled) return;
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, "auth-payment-results.json"), JSON.stringify({
    generatedAt: new Date().toISOString(), driver: "postgres-js; prepare:false",
    database: "fresh loopback-only PostgreSQL; synthetic data; no external provider calls",
    runtime: process.version, defaultPoolMax: 2,
    limitations: "Hono routes under Node, not deployed Deno, Supabase gateway, Cloudflare, bank or SMS network. Burst timing is local measured latency, not production capacity certification.",
    measurements: records,
  }, null, 2));
  await client?.end();
  vi.restoreAllMocks();
});

async function reset() {
  await client.unsafe(`truncate users, records, otp_codes, provider_capacity_leases,
    auth_rate_limit_buckets, discounts, redemptions, payments, grants, entitlements,
    feedback, anonymous_counters restart identity cascade`).simple();
  await client.unsafe(`insert into plans (id,name_fa,name_en,months,price_toman)
    values ('m1','یک ماه','One month',1,59000) on conflict (id) do nothing`);
  sent = []; fake = fakePsp("http://audit.invalid"); clockMs = Date.now();
  queryCount = 0; smsDelay = requestDelay = verifyDelay = 0;
  smsActive = smsPeak = requestActive = requestPeak = verifyActive = verifyPeak = 0;
  requests = verifies = 0; smsFailure = false; requestOutcome = "issued"; verifyOutcome = "normal";
  env.SMS_PROVIDER_MAX_CONCURRENCY = 32; env.PSP_PROVIDER_MAX_CONCURRENCY = 64;
}

async function seed(n: number) {
  const users = Array.from({ length: n }, (_, i) => ({
    id: randomUUID(), phone: `98912${String(8800000 + i)}`, password_hash: passwordHash,
  }));
  await client`insert into users ${client(users, "id", "phone", "password_hash")}`;
  return Promise.all(users.map(async (user, i) => ({ ...user, ip: `198.51.100.${i + 1}`,
    access: (await issueAccessToken(env, user.id, new Date(clockMs))).access,
  })));
}

async function call(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(`/api${path}`, {
    method: body === undefined ? "GET" : "POST", headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const auth = (access: string) => ({ authorization: `Bearer ${access}` });

async function wave(name: string, work: (() => Promise<Response>)[], metadata = {}) {
  const started = performance.now();
  const beforeQueries = queryCount;
  const cpu = process.cpuUsage();
  let peakRss = process.memoryUsage().rss;
  const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  const samples = await Promise.all(work.map(async (fn) => {
    const t = performance.now();
    try {
      const response = await fn();
      const text = await response.text();
      return { status: response.status, ms: performance.now() - t, text,
        retryAfter: response.headers.get("retry-after") };
    } catch (error) { return { status: 0, ms: performance.now() - t, text: String(error), retryAfter: null }; }
  }));
  clearInterval(timer);
  const durations = samples.map((s) => s.ms).sort((a,b) => a-b);
  const percentile = (p: number) => +durations[Math.ceil(p * durations.length) - 1]!.toFixed(2);
  const cpuDelta = process.cpuUsage(cpu);
  records.push({ name, n: work.length, wallMs: +(performance.now() - started).toFixed(2),
    p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99),
    statusCounts: samples.reduce<Record<number, number>>((counts, s) => { counts[s.status] = (counts[s.status] ?? 0) + 1; return counts; }, {}),
    queryCount: queryCount - beforeQueries, queryCountMeaning: "client SQL statements logged by Drizzle; excludes SQL internal work; includes transaction controls",
    cpuMs: +((cpuDelta.user + cpuDelta.system) / 1000).toFixed(2), peakNodeRssMiB: +(peakRss / 1024**2).toFixed(2),
    ...metadata,
  });
  return samples;
}

test("50 simultaneous password logins with Edge-sized max:2 pool", async () => {
  await reset(); const people = await seed(50);
  const responses = await wave("password_login_50_distinct_users", people.map((u) => () => call(
    "/v1/auth/password/login", { identifier: u.phone, password: "Synthetic!2026" }, { "x-forwarded-for": u.ip },
  )), { poolMax: 2 });
  expect(responses.filter((r) => r.status === 200)).toHaveLength(50);
  const bodies = responses.map((r) => JSON.parse(r.text));
  expect(new Set(bodies.map((b) => b.user.id)).size).toBe(50);
  expect(bodies.every((b) => typeof b.access === "string" && !b.refresh && !b.deviceId)).toBe(true);
}, 60_000);

test("50 concurrent OTP requests, safe retry, then 50 concurrent OTP logins", async () => {
  await reset(); const people = await seed(50); smsDelay = 750;
  const request = (u: typeof people[number]) => () => call("/v1/auth/otp/request", { phone: u.phone }, { "x-forwarded-for": u.ip });
  const first = await wave("otp_request_50_distinct_ips_sms750ms", people.map(request), { poolMax: 2, smsLimit: 32, mockSmsDelayMs: 750 });
  records.push({ name: "otp_initial_provider_peak", peak: smsPeak, sent: sent.length });
  expect(first.every((r) => [200,429].includes(r.status))).toBe(true);
  const retryPeople = people.filter((_,i) => first[i]!.status === 429);
  if (retryPeople.length) {
    const retries = await wave("otp_retry_after_capacity_release", retryPeople.map(request), { poolMax: 2 });
    expect(retries.every((r) => r.status === 200)).toBe(true);
  }
  expect(sent).toHaveLength(50);
  const codes = new Map(sent.map((s) => [s.phone,s.code]));
  const logins = await wave("otp_verify_50_distinct_users", people.map((u) => () => call(
    "/v1/auth/otp/verify", { phone: u.phone, code: codes.get(u.phone) }, { "x-forwarded-for": u.ip },
  )), { poolMax: 2 });
  expect(logins.every((r) => r.status === 200)).toBe(true);
  expect((await client`select count(*)::int as n from otp_codes where consumed_at is not null`)[0]!.n).toBe(50);
  expect((await client`select count(*)::int as n from grants`)[0]!.n).toBe(0);
}, 60_000);

test("50 OTP requests from a shared NAT IP and same-code replay diagnostic", async () => {
  await reset(); const people = await seed(50);
  await wave("otp_request_50_shared_nat", people.map((u) => () => call("/v1/auth/otp/request", { phone: u.phone }, { "x-forwarded-for": "203.0.113.10" })), { poolMax: 2, ipLimitPerHour: 20 });
  records.push({ name: "otp_shared_nat_ledger", sent: sent.length, count: (await client`select count(*)::int as n from otp_codes`)[0]!.n });
  expect(sent.length).toBeLessThanOrEqual(20);
  await reset(); const [user] = await seed(1);
  expect((await call("/v1/auth/otp/request", { phone: user!.phone })).status).toBe(200);
  const replay = await wave("otp_same_code_50_replays", Array.from({ length: 50 }, () => () => call("/v1/auth/otp/verify", { phone: user!.phone, code: sent[0]!.code })), { poolMax: 2, intendedInvariant: "exactly one successful use of a one-time code" });
  records.push({ name: "otp_replay_invariant", accepted: replay.filter((r) => r.status === 200).length, rows: await client`select attempts, consumed_at is not null as consumed from otp_codes` });
  expect(replay.filter((r) => r.status === 200)).toHaveLength(1);
}, 60_000);

test("20 simultaneous purchases, duplicate checkouts and 100 callback deliveries", async () => {
  await reset(); const people = await seed(20); requestDelay = 250; verifyDelay = 250;
  const attempts = people.map(() => randomUUID());
  const work = people.map((u,i) => () => call("/v1/payments/checkout", { planId: "m1", attemptId: attempts[i] }, auth(u.access)));
  const responses = await wave("checkout_20_distinct_buyers_provider250ms", work, { poolMax: 2, mockProviderDelayMs: 250 });
  expect(responses.every((r) => r.status === 200)).toBe(true);
  const orders = responses.map((r) => JSON.parse(r.text));
  const replay = await wave("checkout_20_same_attempt_retries", work, { poolMax: 2 });
  expect(replay.every((r) => r.status === 200)).toBe(true);
  expect(requests).toBe(20);
  for (const order of orders) fake._settle(order.authority, "paid");
  await wave("callback_100_deliveries_20_paid_orders", orders.flatMap((order) => Array.from({ length: 5 }, () => () => call(`/v1/payments/callback?paymentId=${order.paymentId}&Authority=${order.authority}&Status=OK`))), { poolMax: 2, duplicateCallbacksPerOrder: 5 });
  const ledger = await client`select count(*)::int as payments, count(*) filter (where status='paid' and applied_at is not null)::int as paid from payments`;
  const grants = await client`select count(*)::int as grants, count(distinct payment_id)::int as unique_payments, count(distinct user_id)::int as unique_users from grants where source='payment'`;
  records.push({ name: "payment_success_invariants", ledger, grants, providerRequests: requests, providerVerifies: verifies, peakCreateCalls: requestPeak, peakVerifyCalls: verifyPeak });
  expect(ledger[0]!.paid).toBe(20); expect(grants[0]!.grants).toBe(20); expect(grants[0]!.unique_users).toBe(20); expect(verifies).toBe(20);
}, 60_000);

test("20 purchases with provider timeout/rejection; ambiguous attempts are never resent", async () => {
  await reset(); const people = await seed(20); requestDelay = 250; requestOutcome = "mixed";
  const work = people.map((u) => { const attemptId = randomUUID(); return () => call("/v1/payments/checkout", { planId: "m1", attemptId }, auth(u.access)); });
  const first = await wave("checkout_20_mixed_provider_results", work, { poolMax: 2, mockDelayMs: 250, pattern: "10 issued / 5 rejected / 5 ambiguous" });
  await wave("checkout_20_mixed_same_attempt_retries", work, { poolMax: 2 });
  expect(first.filter((r) => r.status === 200)).toHaveLength(10);
  expect(first.filter((r) => r.status === 503)).toHaveLength(5);
  expect(first.filter((r) => r.status === 400)).toHaveLength(5);
  expect(requests).toBe(20);
  const states = await client`select status, count(*)::int as n from payments group by status order by status`;
  records.push({ name: "ambiguous_payment_invariants", states, providerRequests: requests, grants: (await client`select count(*)::int as n from grants`)[0]!.n });
  expect((await client`select count(*)::int as n from grants`)[0]!.n).toBe(0);
}, 60_000);

test("PSP verify capacity and unknown callback backoff diagnostics", async () => {
  await reset(); const people = await seed(20);
  const orders = [];
  for (const user of people) orders.push(await (await call("/v1/payments/checkout", { planId: "m1", attemptId: randomUUID() }, auth(user.access))).json());
  env.PSP_PROVIDER_MAX_CONCURRENCY = 1; verifyDelay = 250; verifyOutcome = "unknown";
  const callback = (order: any) => () => call(`/v1/payments/callback?paymentId=${order.paymentId}&Authority=${order.authority}&Status=OK`);
  await wave("verify_20_with_configured_psp_capacity1", orders.map(callback), { poolMax: 2, configuredPspCapacity: 1, providerDelayMs: 250 });
  const peak = verifyPeak; const before = verifies; verifyDelay = 0;
  expect(peak).toBeLessThanOrEqual(1);
  for (let i=0;i<5;i++) await callback(orders[0])();
  const afterCallbacks = verifies;
  expect(afterCallbacks).toBe(before);
  await wave("poll_20_during_verify_backoff", people.map((u,i) => () => call(`/v1/payments/${orders[i].paymentId}`, undefined, auth(u.access))), { poolMax: 2 });
  records.push({ name: "verify_capacity_backoff_diagnostic", configuredPspCapacity: 1, observedPeakVerifyCalls: peak, repeatCallbacks: 5, additionalVerifies: afterCallbacks - before, subsequentPollVerifies: verifies - afterCallbacks, grants: (await client`select count(*)::int as n from grants`)[0]!.n });
  expect((await client`select count(*)::int as n from grants`)[0]!.n).toBe(0);
  expect(verifies).toBe(afterCallbacks);
  clockMs += 6 * 60_000;
  verifyOutcome = "normal";
  for (const order of orders) fake._settle(order.authority, "paid");
  for (let i=0;i<people.length;i++) {
    expect((await call(`/v1/payments/${orders[i].paymentId}`, undefined, auth(people[i]!.access))).status).toBe(200);
  }
  expect((await client`select count(*)::int as n from grants where source='payment'`)[0]!.n).toBe(20);
  expect((await client`select count(*)::int as n from provider_capacity_leases where kind='psp'`)[0]!.n).toBe(0);
}, 60_000);

test("real PostgreSQL statement snapshot diagnostic under 20 locked concurrent OTP claims", async () => {
  await reset(); await client.end(); connect(20);
  const blocker = postgres(url, { prepare: false, max: 1 });
  const monitor = postgres(url, { prepare: false, max: 1 });
  const phone = "989128899999";
  let unlock!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>((r) => { locked = r; });
  const blocked = new Promise<void>((r) => { unlock = r; });
  const holding = blocker.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"otp:phone:" + phone}))`;
    locked(); await blocked;
  });
  await ready;
  const pending = Array.from({ length: 20 }, () => claimSendSlot(db, env, phone, null, new Date(clockMs)));
  let observedWaiting = 0;
  try {
    for (let i=0;i<100;i++) {
      const [row] = await monitor`select count(*)::int as n from pg_stat_activity where datname='auth_payment_audit' and wait_event='advisory'`;
      observedWaiting = row!.n;
      if (observedWaiting === 20) break;
      await delay(20);
    }
  } finally { unlock(); await holding; }
  const outcomes = await Promise.allSettled(pending);
  const accepted = outcomes.filter((r) => r.status === "fulfilled" && r.value !== null).length;
  records.push({ name: "otp_real_pg_lock_snapshot_diagnostic", poolMax: 20, observedConcurrentWaiters: observedWaiting, attempted: 20, accepted,
    rejectedPromises: outcomes.filter((r) => r.status === "rejected").length,
    otpRows: (await client`select count(*)::int as n from otp_codes`)[0]!.n,
    intendedInvariant: "same phone can claim at most one OTP per minute" });
  await blocker.end(); await monitor.end();
  expect(observedWaiting).toBe(20);
  expect(accepted).toBe(1);
  await client.end(); connect(2);
}, 60_000);

test("mixed wave: 1000 syncs plus 50 password logins plus 20 checkouts", async () => {
  await reset();
  const people = await seed(1_000);
  requestDelay = 250;
  const work = [
    ...people.map((u) => () => call("/v1/sync/exchange", {
      protocolVersion: 2, cursor: 0, records: [], includeAccountState: false,
    }, auth(u.access))),
    ...people.slice(0, 50).map((u) => () => call("/v1/auth/password/login", {
      identifier: u.phone, password: "Synthetic!2026",
    }, { "x-forwarded-for": u.ip })),
    ...people.slice(50, 70).map((u) => () => call("/v1/payments/checkout", {
      planId: "m1", attemptId: randomUUID(),
    }, auth(u.access))),
  ];
  const responses = await wave("mixed_1000_sync_50_login_20_checkout", work, {
    poolMax: 2, syntheticAccounts: 1000, recordsPerAccount: 0,
    caveat: "Empty-account sync contention; populated sync is measured separately.",
  });
  expect(responses.filter((r) => r.status === 200)).toHaveLength(1070);
  expect(requests).toBe(20);
  expect((await client`select count(*)::int as n from payments`)[0]!.n).toBe(20);
}, 60_000);
