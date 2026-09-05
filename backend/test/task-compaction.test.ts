import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "../src/db/ddl.js";
import { validateTaskPayload } from "../src/services/sync-record-validation.js";
import { pullRecords } from "../src/services/sync.js";
import { expandTaskMonthArchive } from "../src/services/task-month-archive.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

const OWNER = "c1111111-1111-4111-8111-111111111111";
const NOW = "2026-06-15T12:00:00.000Z";
const OLD_UPDATED_AT = Date.parse("2026-06-01T00:00:00.000Z");
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PRECHECK_SQL_PATH = resolve(
  root,
  "supabase/manual-production/20260901_task_archive_precheck.sql",
);
const POSTCHECK_SQL_PATH = resolve(
  root,
  "supabase/manual-production/20260901_task_archive_postcheck.sql",
);
const RESTORE_SQL_PATH = resolve(
  root,
  "supabase/manual-production/20260901_task_archive_restore.sql",
);
const SETUP_SQL_PATH = resolve(root, "supabase/setup.sql");
const RESTORE_OWNER_SENTINEL = "00000000-0000-0000-0000-000000000000";
const LOAD_OWNERS = [
  OWNER,
  ...Array.from(
    { length: 9 },
    (_, index) =>
      `c2${String(index + 1).padStart(6, "0")}-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
  ),
];

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.raw(`
    drop trigger if exists routino_test_corrupt_task_archive on records;
    drop trigger if exists routino_test_strip_task_archive on records;
    drop trigger if exists routino_test_duplicate_task_archive on records;
    drop trigger if exists routino_test_delay_task_archive on records;
    drop function if exists routino_test_corrupt_task_archive();
    drop function if exists routino_test_strip_task_archive();
    drop function if exists routino_test_duplicate_task_archive();
    drop function if exists routino_test_delay_task_archive();
    set statement_timeout = 0;
    set timezone = 'UTC';
  `);
  await h.truncate();
  await h.raw(`
    insert into users (id, phone, sync_growth_period_started_at)
    values ('${OWNER}', '989122288880', '2026-01-01T00:00:00Z')
  `);
});

afterAll(async () => {
  await h?.close();
});

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlJson(value: unknown): string {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

function task(
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    dateKey: "2026-05-01",
    title: `کار ${id}`,
    type: "binary",
    target: 1,
    value: 1,
    done: true,
    ...overrides,
  };
}

async function insertTask(id: string, data: unknown, updatedAt = OLD_UPDATED_AT): Promise<void> {
  await h.raw(`
    insert into records (user_id, kind, id, data, updated_at, deleted, seq)
    values ('${OWNER}', 'tasks', ${sqlText(id)}, ${sqlJson(data)}, ${updatedAt}, false, 0)
  `);
}

async function rawKindCount(kind: string): Promise<number> {
  const [row] = await h.query<{ count: number }>(`
    select count(*)::integer as count from records
     where user_id = '${OWNER}' and kind = ${sqlText(kind)}
  `);
  return Number(row!.count);
}

async function semanticTasks(): Promise<unknown[]> {
  return h.query(`
    with candidates as (
      select r.id, r.updated_at, r.data, r.seq
        from records r
       where r.user_id = '${OWNER}' and r.kind = 'tasks' and not r.deleted
      union all
      select item->>0, (item->>1)::bigint, item->2, a.seq
        from records a
        cross join lateral jsonb_array_elements(a.data->'items') item
       where a.user_id = '${OWNER}' and a.kind = 'taskMonths' and not a.deleted
    )
    select distinct on (id) id, updated_at::text, data
      from candidates
     order by id, updated_at desc, seq desc
  `);
}

async function semanticTaskCount(): Promise<number> {
  const [row] = await h.query<{ count: number }>(`
    with candidates as (
      select r.id
        from records r
       where r.user_id = '${OWNER}' and r.kind = 'tasks' and not r.deleted
      union all
      select item->>0
        from records a
        cross join lateral jsonb_array_elements(a.data->'items') item
       where a.user_id = '${OWNER}' and a.kind = 'taskMonths' and not a.deleted
    )
    select count(distinct id)::integer as count from candidates
  `);
  return Number(row!.count);
}

async function usage() {
  const [row] = await h.query<{
    seq: number;
    gc_seq: number;
    sync_record_count: number;
    sync_data_bytes: number;
    sync_growth_bytes: number;
  }>(`
    select seq, gc_seq, sync_record_count, sync_data_bytes, sync_growth_bytes
      from users where id = '${OWNER}'
  `);
  return {
    seq: Number(row!.seq),
    gc: Number(row!.gc_seq),
    rows: Number(row!.sync_record_count),
    bytes: Number(row!.sync_data_bytes),
    annual: Number(row!.sync_growth_bytes),
  };
}

async function assertExactPhysicalCounters(): Promise<void> {
  const [expected] = await h.query<{ rows: number; bytes: number }>(`
    select count(*)::integer as rows,
           coalesce(sum(octet_length(data::text)), 0)::bigint as bytes
      from records where user_id = '${OWNER}'
  `);
  const actual = await usage();
  expect(actual.rows).toBe(Number(expected!.rows));
  expect(actual.bytes).toBe(Number(expected!.bytes));
}

async function semanticTasksFor(ownerIds: string[]): Promise<unknown[]> {
  return h.query(`
    with candidates as (
      select r.user_id, r.id, r.updated_at, r.data, r.seq
        from records r
       where r.user_id in (${ownerIds.map(sqlText).join(", ")})
         and r.kind = 'tasks' and not r.deleted
      union all
      select a.user_id, item->>0, (item->>1)::bigint, item->2, a.seq
        from records a
        cross join lateral jsonb_array_elements(a.data->'items') item
       where a.user_id in (${ownerIds.map(sqlText).join(", ")})
         and a.kind = 'taskMonths' and not a.deleted
    )
    select distinct on (user_id, id) user_id::text as user_id, id, updated_at::text, data
      from candidates
     order by user_id, id, updated_at desc, seq desc
  `);
}

async function exactCounters(ownerIds: string[]): Promise<unknown[]> {
  return h.query(`
    select id::text as user_id, sync_record_count::integer as rows,
           sync_data_bytes::bigint::text as bytes
      from users
     where id in (${ownerIds.map(sqlText).join(", ")})
     order by id
  `);
}

async function recomputedCounters(ownerIds: string[]): Promise<unknown[]> {
  return h.query(`
    select u.id::text as user_id, count(r.*)::integer as rows,
           coalesce(sum(octet_length(r.data::text)), 0)::bigint::text as bytes
      from users u
      left join records r on r.user_id = u.id
     where u.id in (${ownerIds.map(sqlText).join(", ")})
     group by u.id
     order by u.id
  `);
}

function taskCompactionSchedule(): { batchSize: number; runsPerDay: number } {
  const sql = readFileSync(SETUP_SQL_PATH, "utf8");
  const start = sql.indexOf("'routino-task-month-compaction'");
  expect(start).toBeGreaterThan(-1);
  const scheduled = sql.slice(start, start + 500);
  const cronExpression = scheduled.match(/'routino-task-month-compaction',\s*'([^']+)'/)?.[1];
  const batchSize = Number(
    scheduled.match(/routino_run_task_month_compaction\(now\(\),\s*(\d+)\)/)?.[1],
  );
  expect(cronExpression).toBeDefined();
  expect(batchSize).toBeGreaterThan(0);

  const fields = cronExpression!.trim().split(/\s+/);
  expect(fields).toHaveLength(5);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  expect([dayOfMonth, month, dayOfWeek]).toEqual(["*", "*", "*"]);
  let runsPerDay = 0;
  if (minute === "*" && hour === "*") runsPerDay = 24 * 60;
  else if (/^\*\/\d+$/.test(minute!) && hour === "*") {
    runsPerDay = (24 * 60) / Number(minute!.slice(2));
  } else if (/^\d+$/.test(minute!) && hour === "*") runsPerDay = 24;
  else if (/^\d+$/.test(minute!) && /^\d+$/.test(hour!)) runsPerDay = 1;
  expect(Number.isInteger(runsPerDay)).toBe(true);
  expect(runsPerDay).toBeGreaterThan(0);
  return { batchSize, runsPerDay };
}

function recoverySql(path: string): string {
  return readFileSync(path, "utf8");
}

function restoreSqlFor(ownerId: string): string {
  const sql = recoverySql(RESTORE_SQL_PATH);
  expect(sql).toContain(RESTORE_OWNER_SENTINEL);
  return sql.replace(RESTORE_OWNER_SENTINEL, ownerId);
}

async function ordinaryTaskTuples(): Promise<unknown[]> {
  return h.query(`
    select user_id::text as user_id, id, updated_at::text as updated_at,
           deleted, data
      from records
     where user_id = '${OWNER}' and kind = 'tasks'
     order by id
  `);
}

async function archiveRows(): Promise<unknown[]> {
  return h.query(`
    select id, md5(data::text) as archive_hash, updated_at::text, deleted, seq::text
      from records
     where user_id = '${OWNER}' and kind = 'taskMonths'
     order by id
  `);
}

async function expectRestoreToAbortWithoutMutation(error: RegExp): Promise<void> {
  const beforeArchives = await archiveRows();
  const beforeUsage = await usage();
  const beforeTasks = await ordinaryTaskTuples();

  try {
    await expect(h.raw(restoreSqlFor(OWNER))).rejects.toThrow(error);
  } finally {
    await h.raw("rollback");
  }

  expect(await archiveRows()).toEqual(beforeArchives);
  expect(await ordinaryTaskTuples()).toEqual(beforeTasks);
  expect(await usage()).toEqual(beforeUsage);
  await assertExactPhysicalCounters();
}

async function compactOneTask(id: string, month = "2026-05"): Promise<void> {
  await insertTask(id, task(id, { dateKey: `${month}-01` }));
  await h.query(`select * from routino_compact_task_months('${NOW}', 10)`);
  expect(await rawKindCount("taskMonths")).toBe(1);
}

describe("task archive SQL predicate", () => {
  it("agrees with the canonical TypeScript validator for valid and malformed task fixtures", async () => {
    const fixtures: Array<[string, string, unknown]> = [
      ["minimal", "valid-1", task("valid-1")],
      [
        "bounded Persian and emoji optionals",
        "valid-2",
        task("valid-2", {
          title: "ر".repeat(250) + "😀".repeat(3),
          type: "quantity",
          target: 1_000_000_000,
          value: 0.5,
          note: "یادداشت 😀",
          unitKind: "time",
          reminderAt: null,
          color: "#fff",
          icon: "✅",
        }),
      ],
      ["extra key", "bad-extra", task("bad-extra", { surprise: true })],
      ["id mismatch", "bad-id", task("another-id")],
      ["impossible date", "bad-date", task("bad-date", { dateKey: "2026-02-30" })],
      ["empty title", "bad-title", task("bad-title", { title: "" })],
      ["too many UTF-16 title units", "bad-units", task("bad-units", { title: "😀".repeat(129) })],
      ["wrong type", "bad-type", task("bad-type", { type: "count" })],
      ["negative target", "bad-target", task("bad-target", { target: -1 })],
      ["string value", "bad-value", task("bad-value", { value: "1" })],
      ["non-boolean done", "bad-done", task("bad-done", { done: 1 })],
      ["oversized note", "bad-note", task("bad-note", { note: "ن".repeat(4_001) })],
      ["invalid unit", "bad-unit", task("bad-unit", { unitKind: "minutes" })],
      ["invalid reminder", "bad-reminder", task("bad-reminder", { reminderAt: 123 })],
      ["array payload", "bad-array", []],
    ];

    for (const [name, id, data] of fixtures) {
      const [row] = await h.query<{ valid: boolean }>(`
        select routino_task_archive_candidate_valid(${sqlText(id)}, ${sqlJson(data)}) as valid
      `);
      expect(row!.valid, name).toBe(validateTaskPayload(id, data));
    }
  });

  it("rejects an oversized legacy payload before invoking character scanning", async () => {
    await h.raw(`
      begin;
      create or replace function routino_js_string_length(p_text text)
      returns integer language plpgsql immutable strict as $$
      begin
        raise exception 'length scanner called';
      end
      $$;
    `);
    try {
      const oversized = task("oversized-legacy", { title: "x".repeat(21 * 1024) });
      const [row] = await h.query<{ valid: boolean }>(`
        select routino_task_archive_candidate_valid(
          'oversized-legacy', ${sqlJson(oversized)}
        ) as valid
      `);
      expect(row!.valid).toBe(false);
    } finally {
      await h.raw("rollback");
    }
  });
});

describe("bounded transactional task compaction", () => {
  it("offers the planner the owner-month partial index for eligible ordered work", async () => {
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      select '${OWNER}', 'tasks', 'planner-' || value,
             jsonb_build_object(
               'id', 'planner-' || value,
               'dateKey', case when value % 2 = 0 then '2026-04-01' else '2026-05-01' end,
               'title', 'planner task ' || value,
               'type', 'binary', 'target', 1, 'value', 1, 'done', true
             ),
             ${OLD_UPDATED_AT} + value, false, value
        from generate_series(1, 500) value;
    `);
    const planRows = await h.query<Record<string, string>>(`
      explain (costs off)
      select source.user_id, left(source.data->>'dateKey', 7), source.id
        from records source
       where source.kind = 'tasks'
         and source.deleted = false
         and source.data->>'done' = 'true'
         and routino_task_archive_candidate_valid(source.id, source.data)
         and source.updated_at between 0 and 9007199254740991
         and left(source.data->>'dateKey', 7) < '2026-06'
         and source.updated_at <= ${Date.parse(NOW) - 7 * 86_400_000}
         and not exists (
           select 1
             from records archive
             cross join lateral jsonb_array_elements(
               case when jsonb_typeof(archive.data->'items') = 'array'
                 then archive.data->'items' else '[]'::jsonb end
             ) item
            where archive.user_id = source.user_id
              and archive.kind = 'taskMonths'
              and item->>0 = source.id
         )
       order by source.user_id, left(source.data->>'dateKey', 7), source.id collate "C"
       limit 500
    `);
    const plan = planRows.flatMap((row) => Object.values(row)).join("\n");
    expect(plan).toContain("records_task_compaction_owner_month");
  });

  it("drains a 10000-task fixture losslessly within the schedule's theoretical daily ceiling", async () => {
    await h.raw(`
      insert into users (id, phone, sync_growth_period_started_at)
      values ${LOAD_OWNERS.slice(1)
        .map(
          (ownerId, index) =>
            `(${sqlText(ownerId)}, ${sqlText(`9891222777${String(index + 1).padStart(2, "0")}`)}, '2026-01-01T00:00:00Z')`,
        )
        .join(",\n")};

      with owners as (
        select owner_id, owner_no
          from unnest(array[${LOAD_OWNERS.map((ownerId) => `${sqlText(ownerId)}::uuid`).join(", ")}])
               with ordinality as seeded(owner_id, owner_no)
      )
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      select owner_id,
             'tasks',
             task_id,
             jsonb_build_object(
               'id', task_id,
               'dateKey', to_char(date '2025-07-01' + month_no * interval '1 month', 'YYYY-MM-DD'),
               'title', task_id,
               'type', 'binary',
               'target', 1,
               'value', 1,
               'done', true
             ),
             ${OLD_UPDATED_AT} + task_no,
             false,
             0
        from owners
        cross join generate_series(0, 9) month_no
        cross join generate_series(1, 100) task_no
        cross join lateral (
          select 'load-' || lpad(owner_no::text, 2, '0') || '-' ||
                 lpad(month_no::text, 2, '0') || '-' || lpad(task_no::text, 3, '0') as task_id
        ) ids;
    `);

    const [before] = await h.query<{
      eligible_tasks: number;
      candidate_owner_months: number;
      oldest_eligible_at: number;
    }>(`select * from routino_task_compaction_backlog('${NOW}')`);
    const beforeSemantics = await semanticTasksFor(LOAD_OWNERS);
    const schedule = taskCompactionSchedule();
    const theoreticalDailyCapacity = schedule.runsPerDay * schedule.batchSize;

    let processed = 0;
    for (let run = 0; run < schedule.runsPerDay && processed < 10_000; run += 1) {
      const result = await h.query<{ archived_tasks: number }>(
        `select * from routino_run_task_month_compaction('${NOW}', ${schedule.batchSize})`,
      );
      const runProcessed = result.reduce((sum, row) => sum + Number(row.archived_tasks), 0);
      expect(runProcessed).toBeLessThanOrEqual(1_000);
      processed += runProcessed;
    }

    const [after] = await h.query<{ eligible_tasks: number }>(
      `select * from routino_task_compaction_backlog('${NOW}')`,
    );
    expect(Number(before!.eligible_tasks)).toBe(10_000);
    expect(Number(before!.candidate_owner_months)).toBe(100);
    expect(Number(before!.oldest_eligible_at)).toBe(OLD_UPDATED_AT + 1);
    expect(processed).toBe(10_000);
    expect(Number(after!.eligible_tasks)).toBe(0);
    expect(await semanticTasksFor(LOAD_OWNERS)).toEqual(beforeSemantics);
    expect(await exactCounters(LOAD_OWNERS)).toEqual(await recomputedCounters(LOAD_OWNERS));
    expect(schedule.batchSize).toBe(1_000);
    expect(theoreticalDailyCapacity).toBe(1_440_000);
    expect(theoreticalDailyCapacity).toBeGreaterThanOrEqual(100_000);

    const beforeEmptyRun = await h.query(`
      select id::text, seq::text, gc_seq::text, sync_record_count,
             sync_data_bytes::text, sync_growth_bytes::text
        from users where id in (${LOAD_OWNERS.map(sqlText).join(", ")}) order by id
    `);
    expect(
      await h.query(`select * from routino_run_task_month_compaction('${NOW}', 1000)`),
    ).toEqual([]);
    expect(
      await h.query(`
        select id::text, seq::text, gc_seq::text, sync_record_count,
               sync_data_bytes::text, sync_growth_bytes::text
          from users where id in (${LOAD_OWNERS.map(sqlText).join(", ")}) order by id
      `),
    ).toEqual(beforeEmptyRun);
  }, 120_000);

  it("skips unsafe legacy timestamps while valid cold work still progresses", async () => {
    await insertTask("valid-timestamp", task("valid-timestamp"));
    await insertTask("legacy-negative", task("legacy-negative"), -1);
    await insertTask("legacy-over-safe", task("legacy-over-safe"), Number.MAX_SAFE_INTEGER + 1);
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values (
        '${OWNER}', 'tasks', 'legacy-bigint-max',
        ${sqlJson(task("legacy-bigint-max"))},
        9223372036854775807, false, 0
      )
    `);

    const result = await h.query<{ archived_tasks: number }>(
      `select * from routino_compact_task_months('${NOW}', 500)`,
    );
    expect(result.map((row) => Number(row.archived_tasks))).toEqual([1]);
    expect(
      await h.query<{ id: string; updated_at: string }>(`
        select id, updated_at::text from records
         where user_id = '${OWNER}' and kind = 'tasks'
         order by id
      `),
    ).toEqual([
      { id: "legacy-bigint-max", updated_at: "9223372036854775807" },
      { id: "legacy-negative", updated_at: "-1" },
      { id: "legacy-over-safe", updated_at: "9007199254740992" },
    ]);
    expect(await semanticTaskCount()).toBe(4);
  });

  it("uses UTC month boundaries regardless of the database session timezone", async () => {
    await insertTask("utc-boundary", task("utc-boundary"), Date.parse("2026-05-01T00:00:00Z"));
    await h.raw("set timezone = 'Pacific/Kiritimati'");

    expect(
      await h.query("select * from routino_compact_task_months('2026-06-07T12:00:00Z', 1)"),
    ).toEqual([]);
    expect(await rawKindCount("tasks")).toBe(1);
    expect(await rawKindCount("taskMonths")).toBe(0);
  });

  it("archives only eligible cold completed tasks without changing their meaning or annual allowance", async () => {
    for (let index = 0; index < 32; index += 1) {
      await insertTask(
        `eligible-${String(index).padStart(2, "0")}`,
        task(
          `eligible-${String(index).padStart(2, "0")}`,
          index === 0 ? { note: "😀".repeat(2_000) } : {},
        ),
      );
    }
    await insertTask("recent-edit", task("recent-edit"), Date.parse("2026-06-10T00:00:00Z"));
    await insertTask("current-month", task("current-month", { dateKey: "2026-06-01" }));
    await insertTask("incomplete", task("incomplete", { done: false }));
    await insertTask("malformed", { id: "malformed", dateKey: "2026-05-01", done: true });

    const oldOverride = task("override-1", { dateKey: "2026-04-01", title: "قدیمی" });
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values (
        '${OWNER}', 'taskMonths', '2026-04|legacy',
        ${sqlJson({
          v: 1,
          monthKey: "2026-04",
          count: 1,
          checksum: "a".repeat(32),
          items: [["override-1", OLD_UPDATED_AT - 1000, oldOverride]],
        })},
        ${OLD_UPDATED_AT - 1000}, false, 1
      )
    `);
    await insertTask(
      "override-1",
      task("override-1", { dateKey: "2026-04-01", title: "نسخه جدید" }),
      OLD_UPDATED_AT,
    );

    const before = await semanticTasks();
    const beforeGranular = await rawKindCount("tasks");
    const [result] = await h.query<{
      owner_id: string;
      month_key: string;
      archived_tasks: number;
      archive_rows: number;
    }>(`select * from routino_compact_task_months('${NOW}', 32)`);

    expect(result).toMatchObject({
      owner_id: OWNER,
      month_key: "2026-05",
      archived_tasks: 32,
      archive_rows: 1,
    });
    expect(await semanticTasks()).toEqual(before);
    expect(await rawKindCount("tasks")).toBe(beforeGranular - 32);
    expect(await rawKindCount("taskMonths")).toBe(2);
    expect((await usage()).annual).toBe(0);
    await assertExactPhysicalCounters();

    const archives = await h.query<{
      id: string;
      data: unknown;
      updated_at: number;
      seq: number;
    }>(`
      select id, data, updated_at, seq from records
       where user_id = '${OWNER}' and kind = 'taskMonths' and id <> '2026-04|legacy'
    `);
    expect(
      archives.flatMap((archive) =>
        expandTaskMonthArchive({
          kind: "taskMonths",
          id: archive.id,
          data: archive.data,
          updatedAt: Number(archive.updated_at),
          deleted: false,
          seq: Number(archive.seq),
        }),
      ),
    ).toHaveLength(32);

    const afterFirstRun = await usage();
    expect(await h.query(`select * from routino_compact_task_months('${NOW}', 32)`)).toEqual([]);
    expect(await usage()).toEqual(afterFirstRun);
    expect(await semanticTasks()).toEqual(before);
    const duplicateMemberships = await h.query(`
      select item->>0 as id
        from records a cross join lateral jsonb_array_elements(a.data->'items') item
       where a.user_id = '${OWNER}' and a.kind = 'taskMonths'
       group by item->>0 having count(*) > 1
    `);
    expect(duplicateMemberships).toEqual([]);
  });

  it("rolls back every selected source row when inserted archive verification detects corruption", async () => {
    await insertTask("checksum-source", task("checksum-source"));
    const before = await usage();
    await h.raw(`
      create or replace function routino_test_corrupt_task_archive()
      returns trigger language plpgsql as $$
      begin
        if new.kind = 'taskMonths' then
          new.data = jsonb_set(new.data, '{checksum}', to_jsonb(repeat('0', 32)));
        end if;
        return new;
      end
      $$;
      create trigger routino_test_corrupt_task_archive
        before insert on records for each row
        execute function routino_test_corrupt_task_archive();
    `);

    await expect(h.query(`select * from routino_compact_task_months('${NOW}', 1)`)).rejects.toThrow(
      /task archive verification failed/i,
    );

    expect(await rawKindCount("tasks")).toBe(1);
    expect(await rawKindCount("taskMonths")).toBe(0);
    expect(await usage()).toEqual(before);
  });

  it("fails closed when an inserted archive loses required decoder metadata", async () => {
    await insertTask("metadata-source", task("metadata-source"));
    const before = await usage();
    await h.raw(`
      create or replace function routino_test_strip_task_archive()
      returns trigger language plpgsql as $$
      begin
        if new.kind = 'taskMonths' then new.data = new.data - 'v'; end if;
        return new;
      end
      $$;
      create trigger routino_test_strip_task_archive
        before insert on records for each row
        execute function routino_test_strip_task_archive();
    `);

    await expect(h.query(`select * from routino_compact_task_months('${NOW}', 1)`)).rejects.toThrow(
      /task archive verification failed/i,
    );

    expect(await rawKindCount("tasks")).toBe(1);
    expect(await rawKindCount("taskMonths")).toBe(0);
    expect(await usage()).toEqual(before);
  });

  it("fails closed when internally consistent archive metadata hides a duplicate tuple", async () => {
    await insertTask("duplicate-source", task("duplicate-source"));
    const before = await usage();
    await h.raw(`
      create or replace function routino_test_duplicate_task_archive()
      returns trigger language plpgsql as $$
      declare
        changed_items jsonb;
        changed_checksum text;
      begin
        if new.kind = 'taskMonths' then
          changed_items := new.data->'items' || jsonb_build_array(new.data->'items'->0);
          select md5(string_agg(
            item->>0 || E'\\n' || (item->>1)::bigint::text || E'\\n' || (item->2)::text,
            E'\\n' order by item->>0
          )) into changed_checksum
            from jsonb_array_elements(changed_items) item;
          new.data := jsonb_set(new.data, '{items}', changed_items);
          new.data := jsonb_set(
            new.data, '{count}', to_jsonb(jsonb_array_length(changed_items))
          );
          new.data := jsonb_set(new.data, '{checksum}', to_jsonb(changed_checksum));
        end if;
        return new;
      end
      $$;
      create trigger routino_test_duplicate_task_archive
        before insert on records for each row
        execute function routino_test_duplicate_task_archive();
    `);

    await expect(h.query(`select * from routino_compact_task_months('${NOW}', 1)`)).rejects.toThrow(
      /task archive verification failed/i,
    );

    expect(await rawKindCount("tasks")).toBe(1);
    expect(await rawKindCount("taskMonths")).toBe(0);
    expect(await usage()).toEqual(before);
  });

  it("leaves no partial archive when the compaction statement times out", async () => {
    await insertTask("timeout-source", task("timeout-source"));
    const before = await usage();
    await h.raw(`
      create or replace function routino_test_delay_task_archive()
      returns trigger language plpgsql as $$
      begin
        if new.kind = 'taskMonths' then
          raise exception using
            errcode = '57014',
            message = 'canceling statement due to statement timeout';
        end if;
        return new;
      end
      $$;
      create trigger routino_test_delay_task_archive
        before insert on records for each row
        execute function routino_test_delay_task_archive();
    `);

    await expect(h.query(`select * from routino_compact_task_months('${NOW}', 1)`)).rejects.toThrow(
      /statement timeout|canceling statement/i,
    );
    await h.raw("set statement_timeout = 0");

    expect(await rawKindCount("tasks")).toBe(1);
    expect(await rawKindCount("taskMonths")).toBe(0);
    expect(await usage()).toEqual(before);
  });

  it("splits archive chunks at 32 tasks and 96 KiB of expanded envelopes", async () => {
    for (let index = 0; index < 33; index += 1) {
      const id = `chunk-${String(index).padStart(2, "0")}`;
      await insertTask(id, task(id));
    }
    for (let index = 0; index < 12; index += 1) {
      const id = `large-${String(index).padStart(2, "0")}`;
      await insertTask(id, task(id, { dateKey: "2026-04-01", note: "😀".repeat(2_000) }));
    }

    const results = await h.query<{
      month_key: string;
      archived_tasks: number;
      archive_rows: number;
    }>(`select * from routino_compact_task_months('${NOW}', 500)`);
    expect(
      results.map((result) => ({
        month: result.month_key,
        tasks: Number(result.archived_tasks),
        archives: Number(result.archive_rows),
      })),
    ).toEqual([
      { month: "2026-04", tasks: 12, archives: 2 },
      { month: "2026-05", tasks: 33, archives: 2 },
    ]);

    const chunks = await h.query<{ month_key: string; count: number; expanded_bytes: number }>(`
      select a.data->>'monthKey' as month_key,
             jsonb_array_length(a.data->'items')::integer as count,
             (
               select sum(octet_length(jsonb_build_object(
                 'kind', 'tasks', 'id', item->>0, 'data', item->2,
                 'updatedAt', (item->>1)::bigint, 'deleted', false
               )::text))::bigint
                 from jsonb_array_elements(a.data->'items') item
             ) as expanded_bytes
        from records a
       where a.user_id = '${OWNER}' and a.kind = 'taskMonths'
    `);
    expect(chunks.every((chunk) => Number(chunk.count) <= 32)).toBe(true);
    expect(chunks.every((chunk) => Number(chunk.expanded_bytes) <= 96 * 1024)).toBe(true);
    expect(chunks.filter((chunk) => chunk.month_key === "2026-04")).toHaveLength(2);
  });

  it("pulls a real compacted quantity archive with PostgreSQL decimal numeric text", async () => {
    const decimalTasks = [
      ["Z-decimal", 1.125],
      ["a-small", 1e-7],
      ["b-tiny", 1e-10],
    ] as const;
    for (const [id, value] of decimalTasks) {
      await insertTask(
        id,
        task(id, { type: "quantity", target: value, value, dateKey: "2026-05-01" }),
        OLD_UPDATED_AT + decimalTasks.findIndex(([taskId]) => taskId === id),
      );
    }

    await h.query(`select * from routino_compact_task_months('${NOW}', 10)`);

    const [archive] = await h.query<{
      id: string;
      data: { items: [string, number, { target: number; value: number }][] };
      updated_at: string;
      seq: string;
    }>(`
      select id, data, updated_at::text, seq::text
        from records
       where user_id = '${OWNER}' and kind = 'taskMonths'
    `);
    expect(archive!.data.items.map(([id]) => id)).toEqual(["Z-decimal", "a-small", "b-tiny"]);
    expect(archive!.data.items.map(([, , data]) => data.target)).toEqual([1.125, 1e-7, 1e-10]);

    const page = await pullRecords(h.db, OWNER, 0, 10);
    expect(page).toMatchObject({
      cursor: Number(archive!.seq),
      hasMore: false,
      reset: false,
    });
    expect(page.records).toEqual(
      archive!.data.items.map(([id, updatedAt, data]) => ({
        kind: "tasks",
        id,
        data,
        updatedAt,
        deleted: false,
        seq: Number(archive!.seq),
      })),
    );
  });

  it("uses C collation for every archive checksum and item-array ordering", () => {
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260901151000_task_month_compactor.sql"),
      "utf8",
    );
    const restore = recoverySql(RESTORE_SQL_PATH);
    for (const sql of [SCHEMA_SQL, migration]) {
      expect(sql).toContain('order by selected.task_id collate "C"');
      expect(sql).toContain('order by items.task_id collate "C"');
      expect(sql).toContain('order by (item->>0) collate "C"');
    }
    expect(restore).toContain('order by item.task_id collate "C"');
  });

  it("clamps a request for 501 tasks to exactly 500 source rows", async () => {
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      select '${OWNER}', 'tasks', task_id,
             jsonb_build_object(
               'id', task_id,
               'dateKey', '2026-05-01',
               'title', task_id,
               'type', 'binary',
               'target', 1,
               'value', 1,
               'done', true
             ),
             ${OLD_UPDATED_AT}, false, 0
        from (
          select 'clamp-' || lpad(value::text, 3, '0') as task_id
            from generate_series(1, 501) value
        ) seeded
    `);

    const result = await h.query<{ archived_tasks: number }>(
      `select * from routino_compact_task_months('${NOW}', 501)`,
    );
    expect(result.reduce((sum, row) => sum + Number(row.archived_tasks), 0)).toBe(500);
    expect(await rawKindCount("tasks")).toBe(1);
    expect(await semanticTaskCount()).toBe(501);
    await assertExactPhysicalCounters();
  });

  it("compacts safely at the exact 50000-row ceiling without changing annual state", async () => {
    await insertTask("at-row-cap", task("at-row-cap"));
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      select '${OWNER}', 'journal', 'cap-filler-' || lpad(value::text, 5, '0'),
             null, 0, true, 0
        from generate_series(1, 49999) value;
      update users
         set sync_growth_period_started_at = '2026-02-03T04:05:06Z',
             sync_growth_bytes = 7777
       where id = '${OWNER}';
    `);
    const [annualBefore] = await h.query<{
      period_start: string;
      used: number;
    }>(`
      select sync_growth_period_started_at::text as period_start,
             sync_growth_bytes as used
        from users where id = '${OWNER}'
    `);
    expect((await usage()).rows).toBe(50_000);
    const before = await semanticTasks();

    const [result] = await h.query<{ archived_tasks: number; archive_rows: number }>(
      `select * from routino_compact_task_months('${NOW}', 1)`,
    );

    expect({
      tasks: Number(result!.archived_tasks),
      archives: Number(result!.archive_rows),
    }).toEqual({ tasks: 1, archives: 1 });
    expect(await semanticTasks()).toEqual(before);
    expect((await usage()).rows).toBe(50_000);
    await assertExactPhysicalCounters();
    expect(
      await h.query(`
        select sync_growth_period_started_at::text as period_start,
               sync_growth_bytes as used
          from users where id = '${OWNER}'
      `),
    ).toEqual([annualBefore]);
  }, 20_000);
});

describe("task archive restore tooling", () => {
  it("restores five years exactly with the same semantic hash and unchanged annual usage", async () => {
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      select '${OWNER}', 'tasks', task_id,
             jsonb_build_object(
               'id', task_id,
               'dateKey', month_key || '-01',
               'title', 'task ' || task_id,
               'type', 'binary',
               'target', 1,
               'value', 1,
               'done', true
             ),
             ${Date.parse("2025-12-01T00:00:00.000Z")} + month_index,
             false,
             month_index
        from (
          select month_index,
                 to_char(date '2021-01-01' + (month_index || ' months')::interval, 'YYYY-MM') as month_key,
                 'five-year-' || lpad(month_index::text, 2, '0') as task_id
            from generate_series(0, 59) month_index
        ) seeded;
      update users
         set sync_growth_period_started_at = '2026-01-01T00:00:00Z',
             sync_growth_bytes = 4321
       where id = '${OWNER}';
    `);

    const originalTuples = await ordinaryTaskTuples();
    const [before] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    expect(originalTuples).toHaveLength(60);
    expect(before?.task_semantic_hash).toMatch(/^[a-f0-9]{32}$/);

    const compacted = await h.query<{ archived_tasks: number }>(
      `select * from routino_compact_task_months('2026-06-15T12:00:00Z', 500)`,
    );
    expect(compacted.reduce((sum, row) => sum + Number(row.archived_tasks), 0)).toBe(60);
    expect(await rawKindCount("tasks")).toBe(0);
    expect(await rawKindCount("taskMonths")).toBe(60);
    await h.raw(`update users set gc_seq = 1 where id = '${OWNER}'`);

    const [postcheck] = await h.query<Record<string, unknown>>(recoverySql(POSTCHECK_SQL_PATH));
    expect(postcheck).toBeDefined();
    for (const [name, value] of Object.entries(postcheck!)) {
      expect(Number(value), name).toBe(0);
    }

    const beforeRestoreUsage = await usage();
    await h.raw(restoreSqlFor(OWNER));

    const [after] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    const restoredTuples = await ordinaryTaskTuples();
    expect(after?.task_semantic_hash).toBe(before?.task_semantic_hash);
    expect(restoredTuples).toEqual(originalTuples);
    expect(await rawKindCount("taskMonths")).toBe(0);
    expect((await usage()).annual).toBe(beforeRestoreUsage.annual);
    expect((await usage()).gc).toBe(beforeRestoreUsage.gc);
    await assertExactPhysicalCounters();

    let cursor = 0;
    let pages = 0;
    const restoredIds = new Set<string>();
    do {
      const page = await pullRecords(h.db, OWNER, cursor, 7);
      expect(page.reset).toBe(false);
      for (const record of page.records) restoredIds.add(record.id);
      cursor = page.cursor;
      pages += 1;
      if (!page.hasMore) break;
    } while (pages < 20);
    expect(pages).toBeGreaterThan(1);
    expect(restoredIds.size).toBe(60);

    console.info(
      `[task-archive-recovery] tuples=${restoredTuples.length} semanticHash=${String(after?.task_semantic_hash)} annualBytes=${(await usage()).annual}`,
    );
  }, 20_000);

  it("rolls back a corrupt checksum without deleting its archive", async () => {
    await insertTask("corrupt-restore", task("corrupt-restore"));
    await h.query(`select * from routino_compact_task_months('${NOW}', 1)`);
    await h.raw(`
      update records
         set data = jsonb_set(data, '{checksum}', to_jsonb(repeat('0', 32)))
       where user_id = '${OWNER}' and kind = 'taskMonths'
    `);
    const beforeRows = await h.query(`
      select id, md5(data::text) as archive_hash, updated_at::text, seq::text
        from records
       where user_id = '${OWNER}' and kind = 'taskMonths'
    `);
    const beforeUsage = await usage();

    try {
      await expect(h.raw(restoreSqlFor(OWNER))).rejects.toThrow(
        /archive|checksum|verification|malformed/i,
      );
    } finally {
      await h.raw("rollback");
    }

    expect(await rawKindCount("tasks")).toBe(0);
    expect(
      await h.query(`
        select id, md5(data::text) as archive_hash, updated_at::text, seq::text
          from records
         where user_id = '${OWNER}' and kind = 'taskMonths'
      `),
    ).toEqual(beforeRows);
    expect(await usage()).toEqual(beforeUsage);
    await assertExactPhysicalCounters();
  });

  it("reports corrupt nonnumeric metadata as counts instead of aborting postcheck", async () => {
    await insertTask("corrupt-count", task("corrupt-count"));
    await h.query(`select * from routino_compact_task_months('${NOW}', 1)`);
    await h.raw(`
      update records
         set data = jsonb_set(data, '{count}', '"not-a-number"'::jsonb)
       where user_id = '${OWNER}' and kind = 'taskMonths'
    `);

    const [postcheck] = await h.query<Record<string, unknown>>(recoverySql(POSTCHECK_SQL_PATH));
    expect(Number(postcheck?.malformed_archive_rows)).toBe(1);
    expect(Number(postcheck?.archive_count_mismatches)).toBe(1);
  });

  it("refuses a negative owner sequence before restoring an archive", async () => {
    await compactOneTask("negative-owner-seq");
    await h.raw(`update users set seq = -1 where id = '${OWNER}'`);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    expect(Number(precheck?.sequence_owner_out_of_bounds)).toBe(1);
    await expectRestoreToAbortWithoutMutation(/sequence/i);
  });

  it("refuses a negative archive sequence before restoring an archive", async () => {
    await compactOneTask("negative-archive-seq");
    await h.raw(`
      update records set seq = -1
       where user_id = '${OWNER}' and kind = 'taskMonths'
    `);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    expect(Number(precheck?.sequence_record_out_of_bounds)).toBe(1);
    await expectRestoreToAbortWithoutMutation(/sequence/i);
  });

  it("refuses an unsafe owner sequence before restoring an archive", async () => {
    await compactOneTask("unsafe-owner-seq");
    await h.raw(`update users set seq = 9007199254740992 where id = '${OWNER}'`);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    expect(Number(precheck?.sequence_owner_out_of_bounds)).toBe(1);
    await expectRestoreToAbortWithoutMutation(/sequence/i);
  });

  it("refuses an unsafe archive sequence before restoring an archive", async () => {
    await compactOneTask("unsafe-archive-seq");
    await h.raw(`
      update records set seq = 9007199254740992
       where user_id = '${OWNER}' and kind = 'taskMonths'
    `);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    expect(Number(precheck?.sequence_record_out_of_bounds)).toBe(1);
    await expectRestoreToAbortWithoutMutation(/sequence/i);
  });

  it("refuses duplicate archive sequences before restoring archives", async () => {
    await insertTask(
      "duplicate-archive-seq-a",
      task("duplicate-archive-seq-a", { dateKey: "2026-04-01" }),
    );
    await insertTask(
      "duplicate-archive-seq-b",
      task("duplicate-archive-seq-b", { dateKey: "2026-05-01" }),
    );
    await h.query(`select * from routino_compact_task_months('${NOW}', 10)`);
    expect(await rawKindCount("taskMonths")).toBe(2);
    await h.raw(`
      update records set seq = (
        select min(seq) from records
         where user_id = '${OWNER}' and kind = 'taskMonths'
      )
       where user_id = '${OWNER}' and kind = 'taskMonths'
    `);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    expect(Number(precheck?.duplicate_record_sequence_groups)).toBe(1);
    await expectRestoreToAbortWithoutMutation(/sequence/i);
  });

  it("refuses an archive sequence colliding with a current ordinary record", async () => {
    await compactOneTask("archive-seq-collision");
    const [archive] = await h.query<{ seq: number }>(`
      select seq from records
       where user_id = '${OWNER}' and kind = 'taskMonths'
    `);
    await insertTask(
      "ordinary-seq-collision",
      task("ordinary-seq-collision", { dateKey: "2026-06-01" }),
    );
    await h.raw(`
      update records set seq = ${Number(archive!.seq)}
       where user_id = '${OWNER}' and kind = 'tasks' and id = 'ordinary-seq-collision';
      update users set seq = ${Number(archive!.seq)} where id = '${OWNER}';
    `);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    expect(Number(precheck?.duplicate_record_sequence_groups)).toBe(1);
    await expectRestoreToAbortWithoutMutation(/sequence/i);
  });

  it("flags a 33-item archive and leaves it untouched when restore aborts", async () => {
    const items = Array.from({ length: 33 }, (_, index) => {
      const id = `over-bound-${String(index).padStart(2, "0")}`;
      return [id, OLD_UPDATED_AT + index, task(id, { dateKey: "2026-05-01" })];
    });
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values (
        '${OWNER}',
        'taskMonths',
        'pending-over-bound',
        ${sqlJson({ v: 1, monthKey: "2026-05", count: 33, checksum: "00000000000000000000000000000000", items })},
        ${OLD_UPDATED_AT + 32},
        false,
        33
      );
      with expanded as (
        select archive_item.task_item
          from records archive
          cross join lateral jsonb_array_elements(archive.data->'items') as archive_item(task_item)
         where archive.user_id = '${OWNER}' and archive.kind = 'taskMonths'
      ), calculated as (
        select md5(string_agg((task_item->>0), E'\\n' order by (task_item->>0))) as id_checksum,
                md5(string_agg(
                 (task_item->>0) || E'\\n' || (task_item->>1) || E'\\n' || (task_item->2)::text,
                 E'\\n' order by (task_item->>0)
               )) as checksum,
               max((task_item->>1)::bigint) as maximum_updated_at
          from expanded
      )
      update records archive
         set id = '2026-05|' || calculated.id_checksum,
             data = jsonb_set(archive.data, '{checksum}', to_jsonb(calculated.checksum)),
             updated_at = calculated.maximum_updated_at
        from calculated
       where archive.user_id = '${OWNER}' and archive.kind = 'taskMonths';
      update users set seq = 33 where id = '${OWNER}';
    `);

    const [postcheck] = await h.query<Record<string, unknown>>(recoverySql(POSTCHECK_SQL_PATH));
    expect(Number(postcheck?.malformed_archive_rows)).toBeGreaterThan(0);
    await expectRestoreToAbortWithoutMutation(/malformed|verification|archive/i);
  });

  it("reports malformed JSON archive shapes without trusting a semantic hash", async () => {
    const malformedArchives = [
      '"scalar"',
      "null",
      '{"v":1,"items":"scalar"}',
      '{"v":2,"items":[]}',
    ];

    for (const archiveData of malformedArchives) {
      await h.raw(`
        insert into records (user_id, kind, id, data, updated_at, deleted, seq)
        values (
          '${OWNER}',
          'taskMonths',
          'malformed-' || md5(${sqlText(archiveData)}::text),
          ${sqlText(archiveData)}::jsonb,
          1,
          false,
          1
        );
        update users set seq = 1 where id = '${OWNER}';
      `);

      const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
      const [postcheck] = await h.query<Record<string, unknown>>(recoverySql(POSTCHECK_SQL_PATH));
      expect(Number(precheck?.invalid_archive_rows)).toBeGreaterThan(0);
      expect(precheck?.task_semantic_hash).toBeNull();
      expect(
        Number(postcheck?.malformed_archive_rows) + Number(postcheck?.unknown_archive_versions),
      ).toBeGreaterThan(0);

      await h.truncate();
      await h.raw(`
        insert into users (id, phone, sync_growth_period_started_at)
        values ('${OWNER}', '989122288880', '2026-01-01T00:00:00Z')
      `);
    }
  });

  it("refuses a negative GC watermark before restoring an archive", async () => {
    await compactOneTask("negative-gc-watermark");
    await h.raw(`update users set gc_seq = -1 where id = '${OWNER}'`);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    const [postcheck] = await h.query<Record<string, unknown>>(recoverySql(POSTCHECK_SQL_PATH));
    expect(Number(precheck?.gc_sequence_out_of_bounds)).toBe(1);
    expect(Number(postcheck?.gc_sequence_out_of_bounds)).toBe(1);
    await expectRestoreToAbortWithoutMutation(/gc|watermark/i);
  });

  it("refuses a GC watermark above the owner sequence before restoring an archive", async () => {
    await compactOneTask("gc-above-owner");
    await h.raw(`update users set gc_seq = seq + 1 where id = '${OWNER}'`);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    const [postcheck] = await h.query<Record<string, unknown>>(recoverySql(POSTCHECK_SQL_PATH));
    expect(Number(precheck?.gc_sequence_above_owner)).toBe(1);
    expect(Number(postcheck?.gc_sequence_above_owner)).toBe(1);
    await expectRestoreToAbortWithoutMutation(/gc|watermark/i);
  });

  it("refuses an unsafe GC watermark before restoring an archive", async () => {
    await compactOneTask("unsafe-gc-watermark");
    await h.raw(`update users set gc_seq = 9007199254740992 where id = '${OWNER}'`);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    const [postcheck] = await h.query<Record<string, unknown>>(recoverySql(POSTCHECK_SQL_PATH));
    expect(Number(precheck?.gc_sequence_out_of_bounds)).toBe(1);
    expect(Number(postcheck?.gc_sequence_out_of_bounds)).toBe(1);
    await expectRestoreToAbortWithoutMutation(/gc|watermark/i);
  });

  it("proves an above-tail GC watermark would reset a fresh multi-page pull and leaves recovery unchanged", async () => {
    await insertTask("gc-loop-a", task("gc-loop-a", { dateKey: "2026-04-01" }));
    await insertTask("gc-loop-b", task("gc-loop-b", { dateKey: "2026-05-01" }));
    await h.query(`select * from routino_compact_task_months('${NOW}', 10)`);

    const fresh = await pullRecords(h.db, OWNER, 0, 1);
    expect(fresh.reset).toBe(false);
    expect(fresh.hasMore).toBe(true);
    expect(fresh.cursor).toBeGreaterThan(0);

    await h.raw(`update users set gc_seq = seq + 1 where id = '${OWNER}'`);
    const loop = await pullRecords(h.db, OWNER, fresh.cursor, 1);
    expect(loop).toMatchObject({ records: [], cursor: 0, hasMore: true, reset: true });

    await expectRestoreToAbortWithoutMutation(/gc|watermark/i);
  });

  it("reports a huge digit-only archive count without throwing or hashing it", async () => {
    await compactOneTask("huge-archive-count");
    await h.raw(`
      update records
         set data = jsonb_set(data, '{count}', '${"9".repeat(200)}'::jsonb)
       where user_id = '${OWNER}' and kind = 'taskMonths'
    `);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    const [postcheck] = await h.query<Record<string, unknown>>(recoverySql(POSTCHECK_SQL_PATH));
    expect(Number(precheck?.invalid_archive_rows)).toBeGreaterThan(0);
    expect(precheck?.task_semantic_hash).toBeNull();
    expect(Number(postcheck?.malformed_archive_rows)).toBeGreaterThan(0);
  });

  it("reports a huge digit-only archive timestamp without throwing or hashing it", async () => {
    await compactOneTask("huge-archive-timestamp");
    await h.raw(`
      update records
         set data = jsonb_set(data, '{items,0,1}', '${"9".repeat(200)}'::jsonb)
       where user_id = '${OWNER}' and kind = 'taskMonths'
    `);

    const [precheck] = await h.query<Record<string, unknown>>(recoverySql(PRECHECK_SQL_PATH));
    const [postcheck] = await h.query<Record<string, unknown>>(recoverySql(POSTCHECK_SQL_PATH));
    expect(Number(precheck?.invalid_archive_rows)).toBeGreaterThan(0);
    expect(precheck?.task_semantic_hash).toBeNull();
    expect(Number(postcheck?.malformed_archive_tuples)).toBeGreaterThan(0);
  });

  it("uses bounded integer columns instead of casting untrusted archive numerics", () => {
    for (const path of [PRECHECK_SQL_PATH, POSTCHECK_SQL_PATH]) {
      const sql = recoverySql(path);
      expect(sql).not.toContain("count_numeric::integer");
      expect(sql).not.toContain("updated_numeric::bigint");
      expect(sql).toContain("safe_count");
      expect(sql).toContain("safe_updated_at");
    }
  });
});
