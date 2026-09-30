import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_SQL } from "../src/db/ddl.js";
import {
  decodeRecordFromStorage,
  encodeRecordForStorage,
} from "../src/services/record-storage-codec.js";
import { validateSyncRecord } from "../src/services/sync-record-validation.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

const migrationSql = readFileSync(
  resolve(
    fileURLToPath(new URL("../..", import.meta.url)),
    "supabase/migrations/20260929202121_add_goals_sync_kind.sql",
  ),
  "utf8",
);

const mixedGoal = {
  id: "goal-mixed",
  title: "آمادگی کامل",
  description: "برای پایان هفته",
  categoryId: "sport",
  reminderAt: "2026-10-05T08:30",
  deadlineAt: "2026-10-05T18:00",
  priority: "critical",
  status: "active",
  items: [
    {
      id: "goal-source-1",
      kind: "source",
      sourceType: "habit",
      sourceId: "habit-1",
      sourceTitleSnapshot: "دویدن",
      measure: "count",
      target: 10,
      unit: "بار",
      linkedAt: 1_000,
      linkedDateKey: "2026-09-29",
      baselineValue: 2,
    },
    { id: "goal-binary-1", kind: "custom", title: "ثبت‌نام", measure: "binary", value: false },
    {
      id: "goal-count-1",
      kind: "custom",
      title: "مطالعه کتاب",
      note: "دو فصل مطالعه شد",
      mood: "💪",
      measure: "count",
      value: 2,
      target: 12,
      unit: "فصل",
    },
    {
      id: "goal-time-1",
      kind: "custom",
      title: "تمرین",
      measure: "time",
      valueMinutes: 45,
      targetMinutes: 300,
    },
  ],
  createdAt: 1_000,
  completedAt: null,
} as const;

const linkedGoal = {
  id: "goal-linked",
  title: "آمادگی مسابقه",
  priority: "normal",
  status: "active",
  items: [mixedGoal.items[0]],
  createdAt: 1_000,
} as const;

const envelope = (data: unknown) => ({
  kind: "goals",
  id: (data as { id: string }).id,
  data,
  updatedAt: 2_000,
  deleted: false,
});

describe("goals sync contract", () => {
  it("accepts unified source and custom items in the same goal", () => {
    for (const data of [mixedGoal, linkedGoal]) {
      const record = envelope(data);
      expect(validateSyncRecord(record)).toEqual({ ok: true, record });
    }
  });

  it("rejects duplicate linked sources, duplicate item ids, and malformed goal values", () => {
    const duplicate = {
      ...linkedGoal,
      items: [linkedGoal.items[0], { ...linkedGoal.items[0], id: "item-2" }],
    };
    const negativeTarget = {
      ...mixedGoal,
      items: [
        {
          id: "invalid-time",
          kind: "custom",
          title: "زمان نامعتبر",
          measure: "time",
          valueMinutes: 0,
          targetMinutes: -1,
        },
      ],
    };
    const duplicateId = {
      ...mixedGoal,
      items: [mixedGoal.items[0], { ...mixedGoal.items[1], id: mixedGoal.items[0].id }],
    };
    const excessiveTimeTarget = {
      ...mixedGoal,
      items: [
        {
          id: "invalid-long-time",
          kind: "custom",
          title: "زمان بیش از حد",
          measure: "time",
          valueMinutes: 0,
          targetMinutes: 10_000 * 60,
        },
      ],
    };

    expect(validateSyncRecord(envelope(duplicate))).toEqual({
      ok: false,
      code: "invalid_record",
    });
    expect(validateSyncRecord(envelope(negativeTarget))).toEqual({
      ok: false,
      code: "invalid_record",
    });
    expect(validateSyncRecord(envelope(duplicateId))).toEqual({
      ok: false,
      code: "invalid_record",
    });
    expect(validateSyncRecord(envelope(excessiveTimeTarget))).toEqual({
      ok: false,
      code: "invalid_record",
    });
  });

  it("round-trips goals through the TypeScript storage codec", () => {
    for (const goal of [mixedGoal, linkedGoal]) {
      const stored = encodeRecordForStorage("goals", goal.id, goal);
      expect(Array.isArray(stored)).toBe(true);
      expect(decodeRecordFromStorage("goals", goal.id, stored)).toEqual(goal);
      expect(decodeRecordFromStorage("goals", goal.id, goal)).toEqual(goal);
    }
  });

  it("stores mixed goal items compactly without losing optional or legacy fields", () => {
    const goal = { ...mixedGoal, items: [
      ...mixedGoal.items,
      { ...mixedGoal.items[2], id: "nullable", note: null, mood: "", unit: null },
    ] };
    const stored = encodeRecordForStorage("goals", goal.id, goal) as unknown[];
    const legacy = [...stored];
    legacy[3] = goal.items;
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(legacy)) * 0.65,
    );
    expect(decodeRecordFromStorage("goals", goal.id, stored)).toEqual(goal);
    expect(decodeRecordFromStorage("goals", goal.id, legacy)).toEqual(goal);
  });

  it("accepts timer sessions linked to one goal item and rejects incomplete goal links", () => {
    const valid = {
      kind: "timerSessions",
      id: "timer-goal-1",
      updatedAt: 2_000,
      deleted: false,
      data: {
        id: "timer-goal-1",
        mode: "free",
        focusSeconds: 90,
        startedAt: 1_000,
        endedAt: 91_000,
        linkedKind: "goal",
        linkedId: "goal-1",
        linkedItemId: "goal-time-1",
        linkedLabel: "تمرکز · مطالعه",
      },
    };

    expect(validateSyncRecord(valid)).toEqual({ ok: true, record: valid });
    expect(
      validateSyncRecord({
        ...valid,
        data: { ...valid.data, linkedItemId: undefined },
      }),
    ).toEqual({ ok: false, code: "invalid_record" });
  });
});

let harness: Harness | undefined;

describe("goals Postgres storage contract", () => {
  beforeEach(async () => {
    harness ??= await makeHarness();
    await harness.truncate();
  });
  afterAll(async () => harness?.close());

  it("allows goals and round-trips them through the SQL codec", async () => {
    await harness!.raw(SCHEMA_SQL);
    const [user] = await harness!.query<{ id: string }>(
      `insert into users (phone) values ('09120000096') returning id`,
    );
    const data = JSON.stringify(mixedGoal).replaceAll("'", "''");
    await harness!.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values ('${user!.id}', 'goals', '${mixedGoal.id}',
        routino_encode_record_data('goals', '${mixedGoal.id}', '${data}'::jsonb),
        2000, false, 1)
    `);

    const [row] = await harness!.query<{ data: unknown }>(`
      select routino_decode_record_data(kind, id, data) as data
        from records
       where user_id = '${user!.id}' and kind = 'goals' and id = '${mixedGoal.id}'
    `);
    expect(row!.data).toEqual(mixedGoal);
    const [compact] = await harness!.query<{ stored: unknown; bytes: number; legacy_bytes: number }>(`
      select data as stored, pg_column_size(data) as bytes,
        pg_column_size(jsonb_set(data, '{3}', '${JSON.stringify(mixedGoal.items).replaceAll("'", "''")}'::jsonb)) as legacy_bytes
      from records where user_id = '${user!.id}' and kind = 'goals'
    `);
    expect(compact!.bytes).toBeLessThan(compact!.legacy_bytes * 0.75);
    expect(compact!.stored).toEqual(encodeRecordForStorage("goals", mixedGoal.id, mixedGoal));
  });

  it("does not increase physical storage by dropping below Postgres compression threshold", async () => {
    const goal = { ...linkedGoal, items: Array.from({ length: 10 }, (_, index) =>
      index % 3 === 0
        ? { ...mixedGoal.items[2], id: `custom-item-${index}`, note: undefined, mood: undefined }
        : { ...mixedGoal.items[0], id: `source-item-${index}`, sourceId: `source-ref-${index}`, linkedAt: 1790793000000 },
    ) };
    const packed = encodeRecordForStorage("goals", goal.id, goal) as unknown[];
    const legacy = [...packed]; legacy[3] = goal.items;
    const [result] = await harness!.query<{ data: unknown }>(`
      select routino_encode_record_data('goals', '${goal.id}', '${JSON.stringify(goal).replaceAll("'", "''")}'::jsonb) as data
    `);
    await harness!.raw(`create temporary table goal_size_check (label text, data jsonb)`);
    await harness!.raw(`insert into goal_size_check values
      ('old', '${JSON.stringify(legacy).replaceAll("'", "''")}'::jsonb),
      ('new', '${JSON.stringify(result!.data).replaceAll("'", "''")}'::jsonb)`);
    const rows = await harness!.query<{ label: string; bytes: number }>(
      `select label, pg_column_size(data) as bytes from goal_size_check order by label`,
    );
    expect(rows[0]!.bytes).toBeLessThanOrEqual(rows[1]!.bytes);
    expect(decodeRecordFromStorage("goals", goal.id, result!.data)).toEqual(JSON.parse(JSON.stringify(goal)));
  });

  it("upgrades a pre-goals schema idempotently without rewriting records", async () => {
    await harness!.raw(`
      alter table records drop constraint records_kind_valid;
      alter table records add constraint records_kind_valid check (kind in
        ('categories','habits','habitMonths','tasks','timerSessions','journal','taskMonths'));

      create or replace function routino_encode_record_data(p_kind text, p_id text, p_data jsonb)
      returns jsonb language plpgsql immutable strict set search_path = public, pg_temp as $$
      begin
        if p_kind = 'goals' then raise exception 'unknown record kind goals'; end if;
        return p_data;
      end $$;

      create or replace function routino_decode_record_data(p_kind text, p_id text, p_data jsonb)
      returns jsonb language plpgsql immutable strict set search_path = public, pg_temp as $$
      begin
        if p_kind = 'goals' then raise exception 'unknown record kind goals'; end if;
        return p_data;
      end $$;
    `);

    const [user] = await harness!.query<{ id: string }>(
      `insert into users (phone) values ('09120000097') returning id`,
    );
    await harness!.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values ('${user!.id}', 'categories', 'existing-category',
        '{"id":"existing-category","nameFa":"قبلی","nameEn":"Existing","color":"gray","icon":"box","isDefault":false}'::jsonb,
        1000, false, 1)
    `);
    const [before] = await harness!.query<{ data: unknown }>(`
      select data from records
       where user_id = '${user!.id}' and kind = 'categories' and id = 'existing-category'
    `);
    const [beforeFunctions] = await harness!.query<{ encode_oid: number; decode_oid: number }>(`
      select 'routino_encode_record_data(text,text,jsonb)'::regprocedure::oid::int as encode_oid,
             'routino_decode_record_data(text,text,jsonb)'::regprocedure::oid::int as decode_oid
    `);

    await harness!.raw(migrationSql);
    await harness!.raw(migrationSql);

    const [after] = await harness!.query<{ data: unknown }>(`
      select data from records
       where user_id = '${user!.id}' and kind = 'categories' and id = 'existing-category'
    `);
    expect(after).toEqual(before);
    const [afterFunctions] = await harness!.query<{
      encode_oid: number;
      decode_oid: number;
      encode_helper: string | null;
      decode_helper: string | null;
    }>(`
      select 'routino_encode_record_data(text,text,jsonb)'::regprocedure::oid::int as encode_oid,
             'routino_decode_record_data(text,text,jsonb)'::regprocedure::oid::int as decode_oid,
             to_regprocedure('public.routino_encode_record_data_pre_goals(text,text,jsonb)')::text as encode_helper,
             to_regprocedure('public.routino_decode_record_data_pre_goals(text,text,jsonb)')::text as decode_helper
    `);
    expect(afterFunctions).toMatchObject({
      encode_oid: beforeFunctions!.encode_oid,
      decode_oid: beforeFunctions!.decode_oid,
      encode_helper: null,
      decode_helper: null,
    });
    const constraints = await harness!.query<{
      conname: string;
      convalidated: boolean;
      definition: string;
    }>(`
      select conname, convalidated, pg_get_constraintdef(oid) as definition
        from pg_constraint
       where conrelid = 'records'::regclass and conname like 'records_kind_valid%'
       order by conname
    `);
    expect(constraints).toEqual([
      expect.objectContaining({
        conname: "records_kind_valid",
        convalidated: true,
        definition: expect.stringContaining("goals"),
      }),
    ]);

    const data = JSON.stringify(linkedGoal).replaceAll("'", "''");
    await harness!.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values ('${user!.id}', 'goals', '${linkedGoal.id}',
        routino_compact_record_data_if_lossless('goals', '${linkedGoal.id}', '${data}'::jsonb),
        2000, false, 1)
    `);
    const [row] = await harness!.query<{ data: unknown }>(`
      select routino_decode_record_data(kind, id, data) as data
        from records
       where user_id = '${user!.id}' and kind = 'goals' and id = '${linkedGoal.id}'
    `);
    expect(row!.data).toEqual(linkedGoal);

    const goalTimerSession = {
      id: "timer-goal-migration",
      mode: "free",
      focusSeconds: 90,
      startedAt: 1_000,
      endedAt: 91_000,
      linkedKind: "goal",
      linkedId: linkedGoal.id,
      linkedItemId: "goal-source-1",
      linkedLabel: "آمادگی مسابقه · دویدن",
    };
    const sessionData = JSON.stringify(goalTimerSession).replaceAll("'", "''");
    await harness!.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values ('${user!.id}', 'timerSessions', '${goalTimerSession.id}',
        routino_compact_record_data_if_lossless(
          'timerSessions', '${goalTimerSession.id}', '${sessionData}'::jsonb),
        3000, false, 2)
    `);
    const [sessionRow] = await harness!.query<{ data: unknown }>(`
      select routino_decode_record_data(kind, id, data) as data
        from records
       where user_id = '${user!.id}' and kind = 'timerSessions' and id = '${goalTimerSession.id}'
    `);
    expect(sessionRow!.data).toEqual(goalTimerSession);
  });
});
