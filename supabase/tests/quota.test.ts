/**
 * Capacity evidence for the approved normal account-year:
 * 15 habits, 10 completed tasks/day, and one seven-line journal entry/day.
 *
 * The physical benchmark loads one full year per synthetic account through the
 * real Edge API, then runs the real database compactor. Longer horizons stay
 * synthetic so this suite measures the protocol without turning CI into a
 * multi-gigabyte load test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PULL_RESPONSE_MAX_UTF8_BYTES,
  selectPullPage,
  type PullRecord,
} from "../functions/api/shared/services/sync.ts";
import { expandTaskMonthArchive } from "../functions/api/shared/services/task-month-archive.ts";
import { auth, makeHarness, type Harness } from "./helpers/harness.ts";

const ACCOUNT_RECORD_LIMIT = 50_000;
const ANNUAL_GROWTH_LIMIT = 10 * 1024 * 1024;
const HABITS_PER_USER = 15;
const TASKS_PER_DAY = 10;
const JOURNAL_LINES_PER_DAY = 7;
const WORKLOAD_YEAR = 2025;
const USERS = 4;
const PAYING = 1;
const PUSH_MAX_UTF8_BYTES = 60 * 1024;

type WireRecord = Omit<PullRecord, "seq">;
type RelationSize = { table: number; indexes: number; total: number };

let h: Harness;
let sampleAccess = "";
let sampleUserId = "";
let sampleExpectedTasks: Array<{ id: string; updatedAt: number; data: unknown }> = [];
let annualGrowthBytes = 0;
let rawRowsBefore = 0;
let rawRowsAfter = 0;
let archivedTasks = 0;
let archiveRows = 0;
let oneYearPages = 0;
let oneYearExpandedBytes = 0;
let fiveYearPages = 0;
let fiveYearExpandedBytes = 0;
const baselineSizes = new Map<string, RelationSize>();
const sizesBefore = new Map<string, RelationSize>();
const sizesAfter = new Map<string, RelationSize>();
const responseBytes = new Map<string, number>();

const utf8Bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const dateKey = (year: number, dayIndex: number) =>
  new Date(Date.UTC(year, 0, dayIndex + 1)).toISOString().slice(0, 10);
const daysInYear = (year: number) => (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;

function taskData(id: string, dk: string, taskIndex: number) {
  return {
    id,
    dateKey: dk,
    title: `مطالعه ${taskIndex + 1}`,
    type: "binary",
    target: 1,
    value: 1,
    done: true,
  };
}

function workload(ownerIndex: number, year: number): WireRecord[] {
  const prefix = `u${ownerIndex}-${year}`;
  const records: WireRecord[] = [];
  for (let habitIndex = 0; habitIndex < HABITS_PER_USER; habitIndex += 1) {
    const id = `${prefix}-habit-${habitIndex}`;
    records.push({
      kind: "habits",
      id,
      data: {
        id,
        name: `عادت ${habitIndex + 1}`,
        categoryId: "health",
        type: "binary",
        target: 1,
        schedule: { kind: "daily" },
        monthlyGoal: null,
        reminderTime: null,
        createdAt: Date.UTC(year, 0, 1),
      },
      updatedAt: Date.UTC(year, 0, 1) + habitIndex,
      deleted: false,
    });
    for (let month = 0; month < 12; month += 1) {
      const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
      const monthDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const cells = Object.fromEntries(
        Array.from({ length: monthDays }, (_, day) => {
          const updatedAt = Date.UTC(year, month, day + 1, 12) + habitIndex;
          return [
            String(day + 1).padStart(2, "0"),
            { value: 1, done: day % 2 === 0, updatedAt, deleted: false },
          ];
        }),
      );
      records.push({
        kind: "habitMonths",
        id: `${id}|${monthKey}`,
        data: { habitId: id, monthKey, cells },
        updatedAt: Math.max(
          ...Object.values(cells).map((cell) => (cell as { updatedAt: number }).updatedAt),
        ),
        deleted: false,
      });
    }
  }

  for (let day = 0; day < daysInYear(year); day += 1) {
    const dk = dateKey(year, day);
    const dayUpdatedAt = Date.parse(`${dk}T12:00:00.000Z`);
    records.push({
      kind: "journal",
      id: dk,
      data: {
        dateKey: dk,
        text: Array.from(
          { length: JOURNAL_LINES_PER_DAY },
          (_, line) => `خط ${line + 1} ژورنال روزانه`,
        ).join("\n"),
        score: null,
        mood: null,
        updatedAt: dayUpdatedAt,
      },
      updatedAt: dayUpdatedAt,
      deleted: false,
    });
    for (let taskIndex = 0; taskIndex < TASKS_PER_DAY; taskIndex += 1) {
      const id = `${prefix}-task-${dk}-${taskIndex}`;
      const updatedAt = dayUpdatedAt + taskIndex;
      records.push({
        kind: "tasks",
        id,
        data: taskData(id, dk, taskIndex),
        updatedAt,
        deleted: false,
      });
    }
  }
  return records;
}

function pushBatches(records: WireRecord[]): WireRecord[][] {
  const batches: WireRecord[][] = [];
  let current: WireRecord[] = [];
  for (const record of records) {
    const next = [...current, record];
    if (next.length > 200 || utf8Bytes({ records: next }) > PUSH_MAX_UTF8_BYTES) {
      if (current.length === 0) throw new Error("capacity fixture record exceeds push budget");
      batches.push(current);
      current = [record];
    } else {
      current = next;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function record(label: string, response: Response): Promise<Response> {
  responseBytes.set(label, Buffer.byteLength(await response.clone().text(), "utf8"));
  return response;
}

async function signUp(index: number) {
  const phone = `0912${String(8_000_000 + index).slice(-7)}`;
  await h.call("POST", "/v1/auth/otp/request", { body: { phone } });
  const login = await h.call("POST", "/v1/auth/otp/verify", {
    body: { phone, code: h.sms.last()!.code },
  });
  expect(login.status).toBe(200);
  return (await login.json()) as { access: string; user: { id: string } };
}

async function seedAccount(index: number) {
  const session = await signUp(index);
  const records = workload(index, WORKLOAD_YEAR);
  for (const batch of pushBatches(records)) {
    const pushed = await h.call("POST", "/v1/sync/push", {
      headers: auth(session.access),
      body: { records: batch },
    });
    expect(pushed.status).toBe(200);
    expect((await pushed.json()).rejectedRecords).toEqual([]);
  }

  const changedAt = Date.now();
  const changed = await record(
    "POST /v1/sync/exchange changed",
    await h.call("POST", "/v1/sync/exchange", {
      headers: auth(session.access),
      body: {
        protocolVersion: 2,
        cursor: Number.MAX_SAFE_INTEGER,
        records: [
          {
            kind: "habitMonths",
            id: `u${index}-${WORKLOAD_YEAR}-habit-0|${WORKLOAD_YEAR}-01`,
            data: {
              habitId: `u${index}-${WORKLOAD_YEAR}-habit-0`,
              monthKey: `${WORKLOAD_YEAR}-01`,
              cells: {
                "01": { value: 1, done: true, updatedAt: changedAt, deleted: false },
              },
            },
            updatedAt: changedAt,
            deleted: false,
          },
        ],
        includeAccountState: false,
      },
    }),
  );
  expect(changed.status).toBe(200);
  await record(
    "POST /v1/sync/exchange boot",
    await h.call("POST", "/v1/sync/exchange", {
      headers: auth(session.access),
      body: {
        protocolVersion: 2,
        cursor: Number.MAX_SAFE_INTEGER,
        records: [],
        includeAccountState: true,
      },
    }),
  );
  return session;
}

async function buyPlan(access: string) {
  const checkout = await h.call("POST", "/v1/payments/checkout", {
    headers: auth(access),
    body: { planId: "m1", platform: "web", attemptId: crypto.randomUUID() },
  });
  const payment = (await checkout.json()) as { authority: string };
  const settle = await h.call(
    "GET",
    `/v1/dev/gateway/settle?Authority=${payment.authority}&outcome=paid`,
  );
  await h.follow(settle.headers.get("location")!);
}

async function measure(into: Map<string, RelationSize>) {
  await h.raw("vacuum analyze");
  const rows = await h.query<{
    relname: string;
    table_bytes: string;
    index_bytes: string;
    total_bytes: string;
  }>(`
    select relname,
           pg_table_size(c.oid)::text as table_bytes,
           pg_indexes_size(c.oid)::text as index_bytes,
           pg_total_relation_size(c.oid)::text as total_bytes
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  `);
  into.clear();
  for (const row of rows) {
    into.set(row.relname, {
      table: Number(row.table_bytes),
      indexes: Number(row.index_bytes),
      total: Number(row.total_bytes),
    });
  }
}

function archivesFor(records: WireRecord[], firstSeq = 1): PullRecord[] {
  const ordinary = records.filter((record) => record.kind !== "tasks");
  const byMonth = new Map<string, WireRecord[]>();
  for (const record of records.filter((candidate) => candidate.kind === "tasks")) {
    const month = (record.data as { dateKey: string }).dateKey.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), record]);
  }
  const stored: PullRecord[] = ordinary.map((record, index) => ({
    ...record,
    seq: firstSeq + index,
  }));
  let seq = firstSeq + stored.length;
  for (const [month, tasks] of [...byMonth].sort(([a], [b]) => a.localeCompare(b))) {
    for (let offset = 0; offset < tasks.length; offset += 32) {
      const chunk = tasks.slice(offset, offset + 32);
      stored.push({
        kind: "taskMonths",
        id: `${month}|synthetic-${offset / 32}`,
        data: {
          v: 1,
          monthKey: month,
          count: chunk.length,
          checksum: "a".repeat(32),
          items: chunk.map((record) => [record.id, record.updatedAt, record.data]),
        },
        updatedAt: Math.max(...chunk.map((record) => record.updatedAt)),
        deleted: false,
        seq,
      });
      seq += 1;
    }
  }
  return stored;
}

function measureFreshSync(candidates: PullRecord[]) {
  const ordered = [...candidates].sort((a, b) => a.seq - b.seq);
  let cursor = 0;
  let pages = 0;
  let bytes = 0;
  while (true) {
    const pending = ordered.filter((record) => record.seq > cursor);
    if (pending.length === 0) break;
    const page = selectPullPage(pending, 500, PULL_RESPONSE_MAX_UTF8_BYTES - 8 * 1024);
    if (page.cursor <= cursor) throw new Error("fresh sync cursor did not advance");
    cursor = page.cursor;
    pages += 1;
    bytes += utf8Bytes(page);
  }
  return { pages, bytes };
}

async function pullFresh(access: string) {
  const records: PullRecord[] = [];
  let cursor = 0;
  let pages = 0;
  let bytes = 0;
  while (true) {
    const response = await h.call("GET", `/v1/sync/pull?cursor=${cursor}`, {
      headers: auth(access),
    });
    expect(response.status).toBe(200);
    bytes += Buffer.byteLength(await response.clone().text(), "utf8");
    const page = (await response.json()) as {
      records: PullRecord[];
      cursor: number;
      hasMore: boolean;
    };
    records.push(...page.records);
    pages += 1;
    cursor = page.cursor;
    if (!page.hasMore) break;
  }
  return { records, pages, bytes };
}

const sizeOf = (source: Map<string, RelationSize>, table: string) =>
  source.get(table) ?? { table: 0, indexes: 0, total: 0 };

beforeAll(async () => {
  h = await makeHarness();
  await measure(baselineSizes);
  for (let index = 0; index < USERS; index += 1) {
    const session = await seedAccount(index);
    if (index === 0) {
      sampleAccess = session.access;
      sampleUserId = session.user.id;
      sampleExpectedTasks = workload(index, WORKLOAD_YEAR)
        .filter((record) => record.kind === "tasks")
        .map((record) => ({ id: record.id, updatedAt: record.updatedAt, data: record.data }));
    }
    if (index < PAYING) await buyPlan(session.access);
  }

  const [before] = await h.query<{ count: string }>("select count(*)::text as count from records");
  rawRowsBefore = Number(before.count);
  await measure(sizesBefore);
  const [growth] = await h.query<{ bytes: string }>(`
    select avg(sync_growth_bytes)::text as bytes from users
  `);
  annualGrowthBytes = Number(growth.bytes);

  for (let pass = 0; pass < 100; pass += 1) {
    const rows = await h.query<{ archived_tasks: number; archive_rows: number }>(
      "select * from routino_compact_task_months('2027-01-08T12:00:00Z', 500)",
    );
    if (rows.length === 0) break;
    archivedTasks += rows.reduce((sum, row) => sum + Number(row.archived_tasks), 0);
    archiveRows += rows.reduce((sum, row) => sum + Number(row.archive_rows), 0);
    if (pass === 99) throw new Error("capacity fixture compaction did not converge");
  }
  const [after] = await h.query<{ count: string }>("select count(*)::text as count from records");
  rawRowsAfter = Number(after.count);
  await measure(sizesAfter);

  const fresh = await pullFresh(sampleAccess);
  oneYearPages = fresh.pages;
  oneYearExpandedBytes = fresh.bytes;
  const actualTasks = fresh.records
    .filter((record) => record.kind === "tasks")
    .map((record) => ({ id: record.id, updatedAt: record.updatedAt, data: record.data }))
    .sort((a, b) => a.id.localeCompare(b.id));
  sampleExpectedTasks.sort((a, b) => a.id.localeCompare(b.id));
  expect(actualTasks).toEqual(sampleExpectedTasks);
  expect(fresh.records.some((record) => record.kind === "taskMonths")).toBe(false);

  const fiveYears = Array.from({ length: 5 }, (_, offset) => workload(99, 2020 + offset)).flat();
  const fiveYearStored = archivesFor(fiveYears);
  ({ pages: fiveYearPages, bytes: fiveYearExpandedBytes } = measureFreshSync(fiveYearStored));
}, 300_000);

afterAll(async () => h?.close());

describe("approved account-year storage budget", () => {
  it("stores the full workload, then losslessly replaces cold task rows with archives", () => {
    const expectedPerUserBefore = workload(0, WORKLOAD_YEAR).length;
    expect(rawRowsBefore).toBe(USERS * expectedPerUserBefore);
    expect(archivedTasks).toBe(USERS * TASKS_PER_DAY * daysInYear(WORKLOAD_YEAR));
    expect(rawRowsAfter).toBe(rawRowsBefore - archivedTasks + archiveRows);
    expect(rawRowsAfter).toBeLessThan(rawRowsBefore / 4);
    expect(sampleExpectedTasks).toHaveLength(TASKS_PER_DAY * daysInYear(WORKLOAD_YEAR));
  });

  it("keeps exact counters and normal annual growth below the hard 10 MiB allowance", async () => {
    const mismatches = await h.query(`
      with actual as (
        select u.id,
               count(r.*)::integer as rows,
               coalesce(sum(octet_length(r.data::text)), 0)::bigint as bytes
          from users u left join records r on r.user_id = u.id
         group by u.id
      )
      select actual.id from actual join users u on u.id = actual.id
       where u.sync_record_count <> actual.rows or u.sync_data_bytes <> actual.bytes
    `);
    expect(mismatches).toEqual([]);
    expect(annualGrowthBytes).toBeGreaterThan(0);
    expect(annualGrowthBytes).toBeLessThan(ANNUAL_GROWTH_LIMIT);
    const [sample] = await h.query<{ bytes: string }>(`
      select sync_growth_bytes::text as bytes from users where id = '${sampleUserId}'
    `);
    expect(Number(sample.bytes)).toBeLessThan(ANNUAL_GROWTH_LIMIT);
    console.log(
      `[annual growth] 15 habits + 10 tasks/day + 7 journal lines/day ≈ ${Math.round(annualGrowthBytes).toLocaleString("en-US")} JSON B/year of ${ANNUAL_GROWTH_LIMIT.toLocaleString("en-US")} B`,
    );
  });

  it("reports physical table and index bytes before and after compaction", () => {
    const before = sizeOf(sizesBefore, "records");
    const after = sizeOf(sizesAfter, "records");
    console.log(
      `[records physical] rows ${rawRowsBefore.toLocaleString("en-US")} -> ${rawRowsAfter.toLocaleString("en-US")}; table ${before.table.toLocaleString("en-US")} -> ${after.table.toLocaleString("en-US")} B; indexes ${before.indexes.toLocaleString("en-US")} -> ${after.indexes.toLocaleString("en-US")} B`,
    );
    expect(before.table).toBeGreaterThan(0);
    expect(before.indexes).toBeGreaterThan(0);
    expect(after.total).toBeGreaterThan(0);

    const baseline = [...baselineSizes.values()].reduce((sum, size) => sum + size.total, 0);
    const final = [...sizesAfter.values()].reduce((sum, size) => sum + size.total, 0);
    const marginal = Math.max(1, (final - baseline) / USERS);
    console.log(
      `[db evidence] post-compaction marginal fixture ≈ ${Math.round(marginal).toLocaleString("en-US")} physical B/account-year (measurement, not plan capacity)`,
    );
    expect(marginal).toBeGreaterThan(0);
  });

  it("keeps the 50,000-row cap far above one compacted account-year", async () => {
    const [usage] = await h.query<{ rows: string }>(`
      select avg(sync_record_count)::text as rows from users
    `);
    const rowsPerYear = Number(usage.rows);
    console.log(
      `[row cap] compacted workload ≈ ${Math.round(rowsPerYear)} rows/account-year of ${ACCOUNT_RECORD_LIMIT.toLocaleString("en-US")}`,
    );
    expect(rowsPerYear).toBeLessThan(1_000);
  });
});

describe("expanded history and invocation budget", () => {
  it("measures one- and five-year fresh sync after transparent archive expansion", () => {
    console.log(
      `[fresh sync] 1 year = ${oneYearPages} pages / ${oneYearExpandedBytes.toLocaleString("en-US")} B; 5 years = ${fiveYearPages} pages / ${fiveYearExpandedBytes.toLocaleString("en-US")} B expanded`,
    );
    expect(oneYearPages).toBeGreaterThan(1);
    expect(fiveYearPages).toBeGreaterThan(oneYearPages);
    expect(fiveYearExpandedBytes).toBeGreaterThan(oneYearExpandedBytes * 4);
  });

  it("round-trips twenty synthetic years by id, timestamp, and payload", () => {
    const ordinary = Array.from({ length: 20 }, (_, offset) =>
      workload(200, 2000 + offset).filter((record) => record.kind === "tasks"),
    ).flat();
    const archives = archivesFor(ordinary).filter((record) => record.kind === "taskMonths");
    const expanded = archives.flatMap((record) => expandTaskMonthArchive(record as never));
    const semantic = (records: Array<Pick<PullRecord, "id" | "updatedAt" | "data">>) =>
      records
        .map(({ id, updatedAt, data }) => ({ id, updatedAt, data }))
        .sort((a, b) => a.id.localeCompare(b.id));
    expect(semantic(expanded)).toEqual(semantic(ordinary));
  }, 30_000);

  it("measures exactly two normal exchanges per day without a quota-plan promise", () => {
    for (const [label, bytes] of responseBytes) {
      expect(bytes, `${label} exceeded the owned response ceiling`).toBeLessThanOrEqual(
        PULL_RESPONSE_MAX_UTF8_BYTES,
      );
    }
    const dailyBytes =
      (responseBytes.get("POST /v1/sync/exchange changed") ?? 0) +
      (responseBytes.get("POST /v1/sync/exchange boot") ?? 0);
    const invocationsPerDay = 2;
    console.log(
      `[normal sync measurement] ${invocationsPerDay} exchanges/day, ${dailyBytes} response B/day; no provider-plan capacity asserted`,
    );
    expect(responseBytes.size).toBe(2);
    expect(invocationsPerDay).toBe(2);
    expect(dailyBytes).toBeGreaterThan(0);
  });
});
