/** Local-only launch audit. Never points at the production database. */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildApp } from "../functions/api/app.ts";
import { SCHEMA_SQL } from "../functions/api/shared/db/ddl.ts";
import { schema } from "../functions/api/shared/db/schema.ts";
import type { Database } from "../functions/api/shared/db/client.ts";
import { loadEnv } from "../functions/api/shared/env.ts";
import { signAccessToken } from "../functions/api/shared/services/tokens.ts";
import { fakePsp } from "../functions/api/shared/providers/psp/fake.ts";
import type { PushRecord } from "../functions/api/shared/services/sync.ts";

const DATABASE_URL = "postgresql://routino_audit@127.0.0.1:55436/sync_audit";
const outputDir = resolve("artifacts/launch-audit-2026-09-06");
const USER_COUNT = 1_000;
const auditTest = process.env.ROUTINO_LOCAL_SYNC_AUDIT === "1" ? it : it.skip;
const admin = postgres(DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
const clients: ReturnType<typeof postgres>[] = [];
const env = loadEnv({
  NODE_ENV: "test",
  JWT_SECRET: "local-launch-stress-sync-fixture-key-2026-only",
  ADMIN_PHONE: "09120000123",
  ADMIN_SESSION_SECRET: "s".repeat(48),
  SMS_PROVIDER: "console",
  PSP_PROVIDER: "fake",
  PROXY_SECRET: "local-sync-proxy",
});

interface Sample {
  label: string;
  latencyMs: number;
  status: number;
  requestUtf8Bytes: number;
  responseUtf8Bytes: number;
  sqlCalls: number;
  sqlByKind: Record<string, number>;
  recordsPushed: number;
  recordsReturned: number;
  applied: number;
  skipped: number;
  rejected: number;
}
interface Account { id: string; token: string; cursor: number }
const context = new AsyncLocalStorage<Sample>();
const samples: Sample[] = [];
const scenarios: Record<string, unknown>[] = [];
let now = Date.now();
const baseTime = now - 86_400_000;

function sqlKind(query: string) {
  if (query.includes("routino_sync_push_if_current(")) return "atomicCursorGatedPush";
  if (query.includes("with owner as (")) return "boundedPull";
  if (query.includes("set active_days = active_days + 1")) return "dailyActivityConditionalUpdate";
  if (query.includes("routino_account_deletion_at")) return "entitlementAndDeletionState";
  if (query.includes('"payments"')) return "openPaymentLookup";
  return query.trim().slice(0, 80).replace(/\s+/g, " ");
}

function makeApp() {
  const client = postgres(DATABASE_URL, {
    prepare: false, max: 2, idle_timeout: 30, connect_timeout: 10,
    onnotice: () => {},
  });
  clients.push(client);
  const db = drizzle(client, {
    schema,
    logger: {
      logQuery(query: string) {
        const sample = context.getStore();
        if (!sample) return;
        sample.sqlCalls += 1;
        const kind = sqlKind(query);
        sample.sqlByKind[kind] = (sample.sqlByKind[kind] ?? 0) + 1;
      },
    },
  }) as unknown as Database;
  return buildApp({
    db, env, psp: fakePsp(env.PUBLIC_API_URL),
    sms: { async sendOtp() { throw new Error("sync test must never send SMS"); } },
    now: () => now,
  });
}

function task(index: number, updatedAt: number, done = false): PushRecord {
  const id = `t-${index}`;
  return {
    kind: "tasks", id, updatedAt, deleted: false,
    data: { id, dateKey: "2026-09-06", title: `کار روزانه ${index}`, type: "binary", target: 1, value: done ? 1 : 0, done },
  };
}

function month(index: number, updatedAt: number, day = "05"): PushRecord {
  return {
    kind: "habitMonths", id: `h-${index}|2026-09`, updatedAt, deleted: false,
    data: { habitId: `h-${index}`, monthKey: "2026-09", cells: { [day]: { updatedAt, deleted: false, value: 1, done: true } } },
  };
}

function journal(index: number, updatedAt: number, long = false): PushRecord {
  const dateKey = `2026-08-${String(index + 1).padStart(2, "0")}`;
  return {
    kind: "journal", id: dateKey, updatedAt, deleted: false,
    data: { dateKey, text: long ? "یادداشت روزانه با حس خوب. ".repeat(80) : "امروز قدم‌های کوچکی برای برنامه‌ام برداشتم. ".repeat(8), score: 8, mood: "😊", updatedAt },
  };
}

function fixtureRows(): PushRecord[] {
  const rows: PushRecord[] = [];
  for (let i = 0; i < 10; i += 1) {
    rows.push({
      kind: "categories", id: `c-${i}`, updatedAt: baseTime, deleted: false,
      data: { id: `c-${i}`, nameFa: `دسته ${i}`, nameEn: `Category ${i}`, color: "#777777", icon: "sun", isDefault: false },
    });
    rows.push({
      kind: "habits", id: `h-${i}`, updatedAt: baseTime, deleted: false,
      data: { id: `h-${i}`, name: `عادت روزانه ${i}`, categoryId: `c-${i}`, type: "binary", target: 1, schedule: { kind: "daily" }, monthlyGoal: null, reminderTime: null, createdAt: baseTime },
    });
    rows.push(month(i, baseTime), task(i, baseTime), journal(i, baseTime));
  }
  return rows;
}

async function storage() {
  const [row] = await admin`
    select (select count(*)::integer from users) as users,
           (select count(*)::integer from records) as records,
           (select sum(sync_record_count)::bigint from users) as counter_records,
           (select sum(sync_data_bytes)::bigint from users) as jsonb_text_bytes,
           (select sum(active_days)::bigint from users) as active_days_sum,
           pg_relation_size('records')::bigint as records_heap_bytes,
           pg_indexes_size('records')::bigint as records_index_bytes,
           pg_total_relation_size('records')::bigint as records_total_bytes`;
  return row;
}

async function seed() {
  await admin.unsafe(SCHEMA_SQL);
  await admin.unsafe("truncate users, records, otp_codes, auth_rate_limit_buckets, discounts, redemptions, payments, grants, entitlements, feedback restart identity cascade");
  const users = Array.from({ length: USER_COUNT }, (_, index) => ({ id: randomUUID(), phone: `9891200${String(index).padStart(4, "0")}` }));
  await admin`insert into users(id,phone,created_at) select id::uuid,phone,now() from jsonb_to_recordset(${admin.json(users)}) as x(id text,phone text)`;
  const rows = fixtureRows().map((row, index) => ({ ...row, seq: index + 1 }));
  await admin`
    insert into records(user_id,kind,id,data,updated_at,deleted,seq)
    select u.id,x.kind,x.id,x.data,x."updatedAt",x.deleted,x.seq
    from users u cross join jsonb_to_recordset(${admin.json(rows)}) as x(kind text,id text,data jsonb,"updatedAt" bigint,deleted boolean,seq bigint)`;
  await admin`update users set seq = 50`;
  await admin.unsafe("analyze users; analyze records");
  const accounts: Account[] = [];
  for (const user of users) {
    accounts.push({ id: user.id, token: await signAccessToken(env, { sub: user.id }, new Date(now)), cursor: 50 });
  }
  return accounts;
}

async function call(app: ReturnType<typeof makeApp>, account: Account, label: string, records: PushRecord[] = [], includeAccountState = false, cursor = account.cursor) {
  const body = JSON.stringify({ protocolVersion: 2, cursor, records, includeAccountState });
  const sample: Sample = { label, latencyMs: 0, status: 0, requestUtf8Bytes: Buffer.byteLength(body), responseUtf8Bytes: 0, sqlCalls: 0, sqlByKind: {}, recordsPushed: records.length, recordsReturned: 0, applied: 0, skipped: 0, rejected: 0 };
  return context.run(sample, async () => {
    const started = performance.now();
    const response = await app.request("/api/v1/sync/exchange", {
      method: "POST", body,
      headers: { "content-type": "application/json", authorization: `Bearer ${account.token}`, "x-proxy-secret": env.PROXY_SECRET },
    });
    const text = await response.text();
    sample.latencyMs = performance.now() - started;
    sample.status = response.status;
    sample.responseUtf8Bytes = Buffer.byteLength(text);
    const result = JSON.parse(text);
    sample.recordsReturned = result.records?.length ?? 0;
    sample.applied = result.applied ?? 0;
    sample.skipped = result.skipped ?? 0;
    sample.rejected = result.rejectedRecords?.length ?? 0;
    samples.push(sample);
    expect(response.status, text.slice(0, 300)).toBe(200);
    expect(result.reset).not.toBe(true);
    expect(result.hasMore).toBe(false);
    expect(result.batchAccepted).toBe(true);
    expect(result.rejectedRecords).toEqual([]);
    if (cursor !== 0) account.cursor = result.cursor;
    return result;
  });
}

const sum = (items: Sample[], name: keyof Sample) => items.reduce((total, item) => total + Number(item[name]), 0);
function aggregate(items: Sample[]) {
  const sorted = items.map((s) => s.latencyMs).sort((a, b) => a - b);
  const percentile = (p: number) => Number((sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0).toFixed(3));
  const sqlByKind: Record<string, number> = {};
  for (const sample of items) for (const [kind, count] of Object.entries(sample.sqlByKind)) sqlByKind[kind] = (sqlByKind[kind] ?? 0) + count;
  return {
    requests: items.length, errors: items.filter((s) => s.status !== 200 || s.rejected > 0).length,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), maxMs: percentile(1),
    requestUtf8Bytes: sum(items, "requestUtf8Bytes"), responseUtf8Bytes: sum(items, "responseUtf8Bytes"),
    sqlCalls: sum(items, "sqlCalls"), sqlByKind,
    recordsPushed: sum(items, "recordsPushed"), recordsReturned: sum(items, "recordsReturned"), applied: sum(items, "applied"), skipped: sum(items, "skipped"),
  };
}

async function scenario(name: string, accounts: Account[], concurrency: number, pools: number, run: (account: Account, index: number) => Promise<void>) {
  const firstSample = samples.length;
  let next = 0;
  let active = 0;
  let peak = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < accounts.length) {
      const index = next++;
      active += 1;
      peak = Math.max(peak, active);
      try { await run(accounts[index]!, index); } finally { active -= 1; }
    }
  }));
  const elapsedMs = performance.now() - started;
  const group = samples.slice(firstSample);
  const result = { name, users: accounts.length, maxConcurrentUserSessions: peak, poolCount: pools, connectionsPerPool: 2, elapsedMs: Number(elapsedMs.toFixed(3)), completedRequestsPerSecond: Number((group.length * 1000 / elapsedMs).toFixed(2)), ...aggregate(group) };
  scenarios.push(result);
  console.log("SYNC_AUDIT_SCENARIO", JSON.stringify(result));
}

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
  await admin.end({ timeout: 5 });
  vi.restoreAllMocks();
});

auditTest("measures local production Edge sync for 1000 active users and explicit concurrent bursts", async () => {
  const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  mkdirSync(outputDir, { recursive: true });
  const [version] = await admin`select version() as version`;
  const accounts = await seed();
  const baselineStorage = await storage();
  const app = makeApp();
  await call(app, accounts[0]!, "warmup");
  samples.length = 0;
  await admin`update users set active_days = 0, last_active_at = null`;

  await scenario("1000-user six-exchange active-day model; one pool", accounts, 25, 1, async (account) => {
    await call(app, account, "day.boot", [], true);
    await call(app, account, "day.edit1", [task(0, now - 10_000, true), month(0, now - 10_000, "06")]);
    await call(app, account, "day.foreground1");
    await call(app, account, "day.edit2", [task(1, now - 9_000, true), month(1, now - 9_000, "06")]);
    await call(app, account, "day.edit3", [journal(0, now - 8_000, true)]);
    await call(app, account, "day.foreground2");
  });
  const afterDayStorage = await storage();
  await scenario("1000 concurrent clean exchanges; one pool", accounts, 1_000, 1, async (account) => { await call(app, account, "burst.clean"); });
  await scenario("1000 concurrent new task writes; one pool", accounts, 1_000, 1, async (account) => { const result = await call(app, account, "burst.write", [task(10, now - 7_000, true)]); expect(result.applied).toBe(1); });
  await scenario("1000 concurrent identical write retries; one pool", accounts, 1_000, 1, async (account) => { const before = account.cursor; const result = await call(app, account, "burst.replay", [task(10, now - 7_000, true)]); expect(result.applied).toBe(0); expect(account.cursor).toBe(before); });
  await scenario("1000 new-device full history pulls; one pool", accounts, 50, 1, async (account) => { const result = await call(app, account, "newDevice", [], true, 0); expect(result.records).toHaveLength(51); });

  const apps = Array.from({ length: 10 }, () => makeApp());
  await Promise.all(apps.map((multiApp, i) => call(multiApp, accounts[i]!, "multiPoolWarmup")));
  await scenario("1000 concurrent clean exchanges; ten independent pools", accounts, 1_000, 10, async (account, i) => { await call(apps[i % 10]!, account, "multi.clean"); });
  await scenario("1000 concurrent new task writes; ten independent pools", accounts, 1_000, 10, async (account, i) => { const result = await call(apps[i % 10]!, account, "multi.write", [task(11, now - 6_000, true)]); expect(result.applied).toBe(1); });
  const finalStorage = await storage();
  expect(Number(finalStorage.active_days_sum)).toBe(1_000);
  expect(Number(finalStorage.records)).toBe(52_000);
  expect(Number(finalStorage.counter_records)).toBe(52_000);

  const byLabel = Object.fromEntries([...new Set(samples.map((s) => s.label))].map((label) => [label, aggregate(samples.filter((s) => s.label === label))]));
  const result = {
    generatedAt: new Date().toISOString(), databaseVersion: version.version,
    environment: { database: "127.0.0.1:55436/sync_audit (fresh local test database)", runtime: process.version, driver: "postgres-js; prepare:false; max:2 per independent pool", application: "real Hono Edge app, auth middleware, generated shared services and SCHEMA_SQL under Node; in-process HTTP Request/Response" },
    limits: ["No Cloudflare, Supabase transaction pooler, Deno isolate CPU/memory caps, TLS, WAN, production data, real provider calls, or billing measured.", "pXX includes local queueing and Node/PostgreSQL time; ten pools share one Node process and are not ten Deno isolates.", "SQL counts are top-level statements submitted through Drizzle, including zero-row conditional UPDATEs; function-internal statements/triggers are additional DB work.", "Byte counts are uncompressed UTF-8 JSON HTTP bodies; headers/TLS/compression and PostgreSQL protocol bytes are excluded.", "Day model has no think-time and compresses six meaningful lifecycle/edit events into a stress workload; it is not an observation of production DAU."],
    dataset: { users: USER_COUNT, initialRowsPerUser: 50, initialShape: "10 categories, 10 habits, 10 habit-month packets, 10 tasks, 10 Persian journals", dayRecordsChangedPerUser: 5, dayExchangesPerUser: 6 },
    scenarios, byLabel, baselineStorage, afterDayStorage, finalStorage,
    slowRequestLogCount: warningSpy.mock.calls.length,
    minimalTwoExchangeDailyModel: aggregate(samples.filter((s) => s.label === "day.boot" || s.label === "day.edit1")),
  };
  writeFileSync(resolve(outputDir, "sync-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(resolve(outputDir, "sync-request-samples.json"), `${JSON.stringify(samples, null, 2)}\n`);
}, 600_000);
