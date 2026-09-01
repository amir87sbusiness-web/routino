import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { validateTaskPayload } from "../src/services/sync-record-validation.js";
import { expandTaskMonthArchive } from "../src/services/task-month-archive.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

const OWNER = "c1111111-1111-4111-8111-111111111111";
const NOW = "2026-06-15T12:00:00.000Z";
const OLD_UPDATED_AT = Date.parse("2026-06-01T00:00:00.000Z");

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

async function insertTask(
  id: string,
  data: unknown,
  updatedAt = OLD_UPDATED_AT,
): Promise<void> {
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
    sync_record_count: number;
    sync_data_bytes: number;
    sync_growth_bytes: number;
  }>(`
    select seq, sync_record_count, sync_data_bytes, sync_growth_bytes
      from users where id = '${OWNER}'
  `);
  return {
    seq: Number(row!.seq),
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
  it("skips unsafe legacy timestamps while valid cold work still progresses", async () => {
    await insertTask("valid-timestamp", task("valid-timestamp"));
    await insertTask("legacy-negative", task("legacy-negative"), -1);
    await insertTask(
      "legacy-over-safe",
      task("legacy-over-safe"),
      Number.MAX_SAFE_INTEGER + 1,
    );
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
        task(`eligible-${String(index).padStart(2, "0")}`, index === 0 ? { note: "😀".repeat(2_000) } : {}),
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

    await expect(
      h.query(`select * from routino_compact_task_months('${NOW}', 1)`),
    ).rejects.toThrow(/task archive verification failed/i);

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

    await expect(
      h.query(`select * from routino_compact_task_months('${NOW}', 1)`),
    ).rejects.toThrow(/task archive verification failed/i);

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

    await expect(
      h.query(`select * from routino_compact_task_months('${NOW}', 1)`),
    ).rejects.toThrow(/task archive verification failed/i);

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

    await expect(
      h.query(`select * from routino_compact_task_months('${NOW}', 1)`),
    ).rejects.toThrow(/statement timeout|canceling statement/i);
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
      await insertTask(
        id,
        task(id, { dateKey: "2026-04-01", note: "😀".repeat(2_000) }),
      );
    }

    const results = await h.query<{
      month_key: string;
      archived_tasks: number;
      archive_rows: number;
    }>(
      `select * from routino_compact_task_months('${NOW}', 500)`,
    );
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
