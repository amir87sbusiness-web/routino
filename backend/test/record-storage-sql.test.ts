import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeHarness, type Harness } from "./helpers/pglite.js";
import {
  decodeRecordFromStorage,
  encodeRecordForStorage,
} from "../src/services/record-storage-codec.js";
import type { StoredSyncKind } from "../src/db/schema.js";

const migrationSql = readFileSync(
  resolve(
    fileURLToPath(new URL("../..", import.meta.url)),
    "supabase/migrations/20260914130000_compact_record_storage.sql",
  ),
  "utf8",
);
const deadlineCodecMigrationSql = readFileSync(
  resolve(
    fileURLToPath(new URL("../..", import.meta.url)),
    "supabase/migrations/20260921140525_preserve_deadlines_in_record_codecs.sql",
  ),
  "utf8",
);
const taskCategoryMigrationSql = readFileSync(
  resolve(
    fileURLToPath(new URL("../..", import.meta.url)),
    "supabase/migrations/20260924173000_task_categories.sql",
  ),
  "utf8",
);

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  await h.raw(deadlineCodecMigrationSql);
  await h.raw(taskCategoryMigrationSql);
});
afterAll(async () => h?.close());

const sqlJson = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

const samples: Array<{ kind: StoredSyncKind; id: string; data: Record<string, unknown> }> = [
  {
    kind: "categories",
    id: "c1",
    data: {
      id: "c1",
      nameFa: "سلامتی",
      nameEn: "Health",
      color: "#0f0",
      icon: "heart",
      isDefault: true,
      isLimit: false,
    },
  },
  {
    kind: "habits",
    id: "h1",
    data: {
      id: "h1",
      name: "آب",
      categoryId: "c1",
      type: "quantity",
      target: 8,
      unit: "لیوان",
      unitKind: "count",
      schedule: { kind: "weekdays", weekdays: [1, 3, 5] },
      monthlyGoal: 20,
      reminderTime: null,
      deadlineTime: "19:45",
      createdAt: 10,
      archived: false,
    },
  },
  {
    kind: "habitMonths",
    id: "h1|2026-01",
    data: {
      habitId: "h1",
      monthKey: "2026-01",
      cells: {
        "01": { updatedAt: 10, deleted: false, value: 1, done: true, mood: "خوب" },
        "02": { updatedAt: 11, deleted: true },
      },
    },
  },
  {
    kind: "tasks",
    id: "t1",
    data: {
      id: "t1",
      dateKey: "2026-01-03",
      title: "کار",
      type: "binary",
      target: 1,
      value: 1,
      done: true,
      note: "یادداشت",
      reminderAt: null,
      deadlineAt: "2026-01-05T18:00",
      categoryId: "c1",
    },
  },
  {
    kind: "timerSessions",
    id: "s1",
    data: {
      id: "s1",
      mode: "focus",
      focusSeconds: 1500,
      startedAt: 10,
      endedAt: 1510,
      linkedKind: "habit",
      linkedId: "h1",
      linkedLabel: "آب",
    },
  },
  {
    kind: "journal",
    id: "2026-01-03",
    data: { dateKey: "2026-01-03", text: "روز خوب", score: 4, mood: null, updatedAt: 12 },
  },
  {
    kind: "taskMonths",
    id: "2026-01|hash",
    data: {
      v: 2,
      monthKey: "2026-01",
      count: 1,
      checksum: "checksum",
      items: [["t1", 12, ["03", "کار", "binary", 1, 1, { done: true }]]],
    },
  },
];

describe("record storage SQL codec", () => {
  it("installs the task-category migration twice without rewriting existing rows", async () => {
    const [user] = await h.query<{ id: string }>(`
      insert into users (phone) values ('09120000075') returning id
    `);
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq) values
        ('${user!.id}', 'tasks', 'legacy-task',
          '["2026-01-03","قدیمی","binary",1,0,false]'::jsonb, 1, false, 1),
        ('${user!.id}', 'tasks', 'deleted-task', null, 2, true, 2);
    `);
    const snapshot = () =>
      h.query(`
        select u.seq::text, u.sync_record_count, u.sync_data_bytes::text,
               r.kind, r.id, r.data, r.updated_at::text, r.deleted, r.seq::text as record_seq
          from users u join records r on r.user_id = u.id
         where u.id = '${user!.id}'
         order by r.kind, r.id
      `);
    const before = await snapshot();

    await h.raw(taskCategoryMigrationSql);
    await h.raw(taskCategoryMigrationSql);

    expect(await snapshot()).toEqual(before);
  });

  it("is safe to install twice and never backfills rows implicitly", async () => {
    await h.raw(migrationSql);
    await h.raw(migrationSql);
    const [user] = await h.query<{ id: string }>(`
      insert into users (phone) values ('09120000073') returning id
    `);
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values ('${user!.id}', 'categories', 'legacy',
        '{"id":"legacy","nameFa":"قدیمی","nameEn":"Legacy","color":"gray","icon":"box","isDefault":false}'::jsonb,
        1, false, 1)
    `);
    const [row] = await h.query<{ storage_type: string }>(`
      select jsonb_typeof(data) as storage_type from records
       where user_id = '${user!.id}' and kind = 'categories' and id = 'legacy'
    `);
    expect(row!.storage_type).toBe("object");
  });

  it("measures compact JSONB text bytes by client record kind", async () => {
    let beforeTotal = 0;
    let afterTotal = 0;
    for (const sample of samples.filter((item) => item.kind !== "taskMonths")) {
      const [row] = await h.query<{ before_bytes: number; after_bytes: number }>(`
        select octet_length(${sqlJson(sample.data)}::text)::int as before_bytes,
               octet_length(routino_encode_record_data(
                 '${sample.kind}', '${sample.id}', ${sqlJson(sample.data)}
               )::text)::int as after_bytes
      `);
      const before = Number(row!.before_bytes);
      const after = Number(row!.after_bytes);
      beforeTotal += before;
      afterTotal += after;
      console.info(`[record-storage-bytes] ${sample.kind} ${before} -> ${after}`);
      expect(after).toBeLessThan(before);
    }
    const saving = (beforeTotal - afterTotal) / beforeTotal;
    expect(saving).toBeGreaterThanOrEqual(0.35);
  });

  it("matches the TypeScript codec and round-trips every stored kind", async () => {
    for (const sample of samples) {
      const [row] = await h.query<{ encoded: unknown; decoded: unknown }>(`
        select routino_encode_record_data('${sample.kind}', '${sample.id}', ${sqlJson(sample.data)}) as encoded,
               routino_decode_record_data(
                 '${sample.kind}', '${sample.id}',
                 routino_encode_record_data('${sample.kind}', '${sample.id}', ${sqlJson(sample.data)})
               ) as decoded
      `);
      expect(row!.encoded).toEqual(encodeRecordForStorage(sample.kind, sample.id, sample.data));
      expect(row!.decoded).toEqual(sample.data);
      expect(decodeRecordFromStorage(sample.kind, sample.id, row!.encoded)).toEqual(sample.data);
    }
  });

  it("backfills in bounded batches and keeps exact stored-byte counters", async () => {
    const [user] = await h.query<{ id: string }>(`
      insert into users (phone) values ('09120000071') returning id
    `);
    const category = samples[0]!;
    const journal = samples[5]!;
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq) values
        ('${user!.id}', '${category.kind}', '${category.id}', ${sqlJson(category.data)}, 1, false, 1),
        ('${user!.id}', '${journal.kind}', '${journal.id}', ${sqlJson(journal.data)}, 2, false, 2),
        ('${user!.id}', 'tasks', 'deleted', null, 3, true, 3),
        ('${user!.id}', 'habits', 'malformed', '{"id":"malformed"}'::jsonb, 4, false, 4);
    `);

    const [first] = await h.query<{ updated_rows: number }>(
      `select * from routino_backfill_compact_records(1)`,
    );
    expect(Number(first!.updated_rows)).toBe(1);
    const [second] = await h.query<{ updated_rows: number }>(
      `select * from routino_backfill_compact_records(100)`,
    );
    expect(Number(second!.updated_rows)).toBe(1);
    const [third] = await h.query<{ updated_rows: number; skipped_rows: number }>(
      `select * from routino_backfill_compact_records(100)`,
    );
    expect(Number(third!.updated_rows)).toBe(0);
    expect(Number(third!.skipped_rows)).toBe(1);

    const [usage] = await h.query<{
      stored_arrays: number;
      tombstones: number;
      sync_record_count: number;
      sync_data_bytes: number;
      actual_bytes: number;
    }>(`
      select count(*) filter (where jsonb_typeof(r.data) = 'array')::int as stored_arrays,
             count(*) filter (where r.deleted)::int as tombstones,
             u.sync_record_count,
             u.sync_data_bytes,
             coalesce(sum(octet_length(r.data::text)), 0)::bigint as actual_bytes
        from users u join records r on r.user_id = u.id
       where u.id = '${user!.id}'
       group by u.sync_record_count, u.sync_data_bytes
    `);
    expect(Number(usage!.stored_arrays)).toBe(2);
    expect(Number(usage!.tombstones)).toBe(1);
    expect(Number(usage!.sync_record_count)).toBe(4);
    expect(Number(usage!.sync_data_bytes)).toBe(Number(usage!.actual_bytes));

    await h.raw(`
      update users set sync_record_count = 0, sync_data_bytes = 0 where id = '${user!.id}'
    `);
    const [reconciled] = await h.query<{
      user_id: string;
      record_count: number;
      data_bytes: number;
    }>(`select * from routino_reconcile_record_storage_counters(null, 100)`);
    expect(reconciled).toMatchObject({ user_id: user!.id, record_count: 4 });
    expect(Number(reconciled!.data_bytes)).toBe(Number(usage!.actual_bytes));
  });

  it("stores new sync writes compactly and charges growth from compact bytes", async () => {
    const [user] = await h.query<{ id: string }>(`
      insert into users (phone) values ('09120000072') returning id
    `);
    const sample = samples[0]!;
    const incoming = [
      {
        kind: sample.kind,
        id: sample.id,
        data: sample.data,
        updatedAt: 10,
        originalUpdatedAt: 10,
        deleted: false,
      },
    ];
    await h.query(`select * from routino_push_records('${user!.id}', now(), ${sqlJson(incoming)})`);
    const [stored] = await h.query<{
      data: unknown;
      bytes: number;
      sync_data_bytes: number;
      sync_growth_bytes: number;
    }>(`
      select r.data, octet_length(r.data::text)::int as bytes,
             u.sync_data_bytes, u.sync_growth_bytes
        from records r join users u on u.id = r.user_id
       where r.user_id = '${user!.id}' and r.kind = '${sample.kind}' and r.id = '${sample.id}'
    `);
    expect(stored!.data).toEqual(encodeRecordForStorage(sample.kind, sample.id, sample.data));
    expect(Number(stored!.sync_data_bytes)).toBe(Number(stored!.bytes));
    expect(Number(stored!.sync_growth_bytes)).toBe(Number(stored!.bytes));
  });

  it("preserves a live task category for legacy payloads and clears it only with explicit null", async () => {
    const [user] = await h.query<{ id: string }>(`
      insert into users (phone) values ('09120000074') returning id
    `);
    const task = (updatedAt: number, data: unknown, deleted = false) => ({
      kind: "tasks",
      id: "task-category",
      data,
      updatedAt,
      originalUpdatedAt: updatedAt,
      deleted,
    });
    const base = {
      id: "task-category",
      dateKey: "2026-01-03",
      title: "کار",
      type: "binary",
      target: 1,
      value: 0,
      done: false,
      color: "#123456",
      icon: "heart",
    };
    const push = async (incoming: unknown[]) => {
      await h.query(
        `select * from routino_push_records('${user!.id}', now(), ${sqlJson(incoming)})`,
      );
      return h.query<{ data: Record<string, unknown> | null; deleted: boolean }>(`
        select routino_decode_record_data(kind, id, data) as data, deleted
          from records
         where user_id = '${user!.id}' and kind = 'tasks' and id = 'task-category'
      `);
    };

    expect((await push([task(1, { ...base, categoryId: "c1" })]))[0]!.data).toMatchObject({
      categoryId: "c1",
    });
    expect((await push([task(2, { ...base, title: "ویرایش قدیمی" })]))[0]!.data).toMatchObject({
      title: "ویرایش قدیمی",
      categoryId: "c1",
    });
    expect(
      (await push([task(3, { ...base, title: "حذف دسته", categoryId: null })]))[0]!.data,
    ).toMatchObject({
      title: "حذف دسته",
      categoryId: null,
    });
    expect(await push([task(4, null, true)])).toEqual([{ data: null, deleted: true }]);
  });
});
