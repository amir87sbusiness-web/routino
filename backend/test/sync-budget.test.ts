import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";
import { pushRecords, type PushRecord } from "../src/services/sync.js";

let h: Harness;

const USER_ID = "00000000-0000-4000-8000-000000000001";
const MAX_RECORDS = 50_000;
const MAX_DATA_BYTES = 128 * 1024 * 1024;
const MAX_ANNUAL_GROWTH_BYTES = 10 * 1024 * 1024;
const PERIOD_START = new Date("2026-09-01T00:00:00.000Z");

const habit = (id: string, name: string, updatedAt = 1_000): PushRecord => ({
  kind: "habits",
  id,
  data: {
    id,
    name,
    categoryId: "c1",
    type: "binary",
    target: 1,
    schedule: { kind: "daily" },
    monthlyGoal: null,
    reminderTime: null,
    createdAt: 1,
  },
  updatedAt,
  deleted: false,
});

async function jsonBytes(data: unknown): Promise<number> {
  const encoded = JSON.stringify(data).replaceAll("'", "''");
  const [row] = await h.query<{ bytes: number }>(
    `select octet_length('${encoded}'::jsonb::text)::integer as bytes`,
  );
  return Number(row!.bytes);
}

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  await h.raw(`
    insert into users (id, phone)
    values ('${USER_ID}', '989120009999')
  `);
});

afterAll(async () => {
  await h?.close();
});

describe("per-account sync storage budget", () => {
  it("tracks record count and stored JSON bytes across insert, update, tombstone, and delete", async () => {
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values
        ('${USER_ID}', 'habits', 'h1', '{"name":"walk"}'::jsonb, 1, false, 1),
        ('${USER_ID}', 'journal', '2026-08-31', null, 1, true, 2)
    `);

    let [usage] = await h.query<{
      sync_record_count: number;
      sync_data_bytes: number;
      actual_count: number;
      actual_bytes: number;
    }>(`
      select u.sync_record_count,
             u.sync_data_bytes,
             count(r.*)::integer as actual_count,
             coalesce(sum(octet_length(r.data::text)), 0)::bigint as actual_bytes
        from users u
        left join records r on r.user_id = u.id
       where u.id = '${USER_ID}'
       group by u.id
    `);
    expect(Number(usage!.sync_record_count)).toBe(2);
    expect(Number(usage!.sync_data_bytes)).toBe(Number(usage!.actual_bytes));
    expect(Number(usage!.actual_count)).toBe(2);

    await h.raw(`
      update records
         set data = '{"name":"a much longer habit name"}'::jsonb,
             updated_at = 2,
             seq = 3
       where user_id = '${USER_ID}' and kind = 'habits' and id = 'h1';
      delete from records
       where user_id = '${USER_ID}' and kind = 'journal' and id = '2026-08-31';
    `);

    [usage] = await h.query(`
      select u.sync_record_count,
             u.sync_data_bytes,
             count(r.*)::integer as actual_count,
             coalesce(sum(octet_length(r.data::text)), 0)::bigint as actual_bytes
        from users u
        left join records r on r.user_id = u.id
       where u.id = '${USER_ID}'
       group by u.id
    `);
    expect(Number(usage!.sync_record_count)).toBe(1);
    expect(Number(usage!.sync_data_bytes)).toBe(Number(usage!.actual_bytes));
    expect(Number(usage!.actual_count)).toBe(1);
  });

  it("rejects direct inserts above the record ceiling without leaving a partial row", async () => {
    await h.raw(`
      update users set sync_record_count = ${MAX_RECORDS} where id = '${USER_ID}'
    `);

    await expect(
      h.raw(`
        insert into records (user_id, kind, id, data, updated_at, deleted, seq)
        values ('${USER_ID}', 'habits', 'overflow', '{"name":"blocked"}'::jsonb, 1, false, 1)
      `),
    ).rejects.toThrow(/users_sync_record_count_bounds/i);

    const [state] = await h.query<{ n: number; sync_record_count: number }>(`
      select count(r.*)::integer as n, u.sync_record_count
        from users u left join records r on r.user_id = u.id
       where u.id = '${USER_ID}'
       group by u.id
    `);
    expect(Number(state!.n)).toBe(0);
    expect(Number(state!.sync_record_count)).toBe(MAX_RECORDS);
  });

  it("keeps exact lifetime bytes nonnegative without imposing a lifetime ceiling", async () => {
    await h.raw(`
      update users set sync_data_bytes = ${MAX_DATA_BYTES} where id = '${USER_ID}';
      insert into records (user_id, kind, id, data, updated_at, deleted, seq) values
        ('${USER_ID}', 'habits', 'tombstone', null, 1, true, 1),
        ('${USER_ID}', 'habits', 'beyond-old-ceiling', '{"name":"allowed"}'::jsonb, 1, false, 2)
    `);

    await expect(
      h.raw(`update users set sync_data_bytes = -1 where id = '${USER_ID}'`),
    ).rejects.toThrow(/users_sync_data_bytes_nonnegative/i);

    const rows = await h.query<{ id: string }>(`
      select id from records where user_id = '${USER_ID}' order by id
    `);
    expect(rows.map((row) => row.id)).toEqual(["beyond-old-ceiling", "tombstone"]);
  });

  it("still allows existing-row edits and deletes at the record-count ceiling", async () => {
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values ('${USER_ID}', 'habits', 'existing', '{"name":"longer"}'::jsonb, 1, false, 1);
      update users set sync_record_count = ${MAX_RECORDS} where id = '${USER_ID}';
      update records
         set data = '{"name":"x"}'::jsonb, updated_at = 2, seq = 2
       where user_id = '${USER_ID}' and kind = 'habits' and id = 'existing';
    `);

    let [usage] = await h.query<{ sync_record_count: number }>(`
      select sync_record_count from users where id = '${USER_ID}'
    `);
    expect(Number(usage!.sync_record_count)).toBe(MAX_RECORDS);

    await h.raw(`
      delete from records
       where user_id = '${USER_ID}' and kind = 'habits' and id = 'existing'
    `);
    [usage] = await h.query(`
      select sync_record_count from users where id = '${USER_ID}'
    `);
    expect(Number(usage!.sync_record_count)).toBe(MAX_RECORDS - 1);
  });

  it("enforces the exact annual positive-growth quota per record", async () => {
    const exact = habit("exact", "مرز دقیق");
    const exactBytes = await jsonBytes(exact.data);
    await h.raw(`
      update users
         set sync_growth_period_started_at = '${PERIOD_START.toISOString()}',
             sync_growth_bytes = ${MAX_ANNUAL_GROWTH_BYTES - exactBytes}
       where id = '${USER_ID}'
    `);

    const exactlyTenMiB = await pushRecords(h.db, USER_ID, [exact], PERIOD_START);
    expect(exactlyTenMiB.applied).toBe(1);

    const beyond = habit("beyond", "یک بایت بیشتر");
    const beyondBytes = await jsonBytes(beyond.data);
    await h.raw(`
      update users set sync_growth_bytes = ${MAX_ANNUAL_GROWTH_BYTES - beyondBytes + 1}
       where id = '${USER_ID}'
    `);
    const oneByteBeyond = await pushRecords(h.db, USER_ID, [beyond], PERIOD_START);
    expect(oneByteBeyond.rejectedRecords[0]).toMatchObject({
      code: "account_quota_exceeded",
      retryAt: Date.parse("2027-09-01T00:00:00.000Z"),
    });
  });

  it("allows shrink and delete at the annual ceiling but does not refund delete-recreate", async () => {
    const original = habit("existing", "نام بسیار طولانی برای رکورد موجود", 1_000);
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values (
        '${USER_ID}', 'habits', 'existing',
        '${JSON.stringify(original.data).replaceAll("'", "''")}'::jsonb,
        1000, false, 1
      );
      update users
         set seq = 1,
             sync_growth_period_started_at = '${PERIOD_START.toISOString()}',
             sync_growth_bytes = ${MAX_ANNUAL_GROWTH_BYTES}
       where id = '${USER_ID}';
    `);

    const shrinkAtCeiling = await pushRecords(
      h.db,
      USER_ID,
      [habit("existing", "کوتاه", 2_000)],
      PERIOD_START,
    );
    expect(shrinkAtCeiling.applied).toBe(1);

    const deletion: PushRecord = {
      kind: "habits",
      id: "existing",
      data: null,
      updatedAt: 3_000,
      deleted: true,
    };
    const deleteAtCeiling = await pushRecords(h.db, USER_ID, [deletion], PERIOD_START);
    expect(deleteAtCeiling.applied).toBe(1);

    const deleteThenRecreate = await pushRecords(
      h.db,
      USER_ID,
      [habit("existing", "بازسازی", 4_000)],
      PERIOD_START,
    );
    expect(deleteThenRecreate.rejectedRecords[0]?.code).toBe("account_quota_exceeded");
    const [usage] = await h.query<{ sync_growth_bytes: number }>(
      `select sync_growth_bytes from users where id = '${USER_ID}'`,
    );
    expect(Number(usage!.sync_growth_bytes)).toBe(MAX_ANNUAL_GROWTH_BYTES);
  });

  it("resets the annual period exactly once after 365 days", async () => {
    const next = habit("next-period", "دوره بعد");
    await h.raw(`
      update users
         set sync_growth_period_started_at = '${PERIOD_START.toISOString()}',
             sync_growth_bytes = ${MAX_ANNUAL_GROWTH_BYTES}
       where id = '${USER_ID}'
    `);

    const tooEarly = await pushRecords(h.db, USER_ID, [next], new Date("2027-08-31T23:59:59.999Z"));
    expect(tooEarly.rejectedRecords[0]).toMatchObject({
      code: "account_quota_exceeded",
      retryAt: Date.parse("2027-09-01T00:00:00.000Z"),
    });

    const reset = await pushRecords(h.db, USER_ID, [next], new Date("2027-09-01T00:00:00.000Z"));
    expect(reset.applied).toBe(1);
    const another = habit("same-period", "همان دوره", 2_000);
    expect(
      (await pushRecords(h.db, USER_ID, [another], new Date("2027-09-01T00:00:00.000Z"))).applied,
    ).toBe(1);

    const [period] = await h.query<{
      started_at: string;
      sync_growth_bytes: number;
    }>(`
      select sync_growth_period_started_at::text as started_at, sync_growth_bytes
        from users where id = '${USER_ID}'
    `);
    expect(new Date(period!.started_at).getTime()).toBe(Date.parse("2027-09-01T00:00:00.000Z"));
    expect(Number(period!.sync_growth_bytes)).toBe(
      (await jsonBytes(next.data)) + (await jsonBytes(another.data)),
    );
  });

  it("serializes concurrent final-byte reservations without overspending", async () => {
    const a = habit("race-a", "x");
    const b = habit("race-b", "y");
    const aBytes = await jsonBytes(a.data);
    const bBytes = await jsonBytes(b.data);
    expect(aBytes).toBe(bBytes);
    await h.raw(`
      update users
         set sync_growth_period_started_at = '${PERIOD_START.toISOString()}',
             sync_growth_bytes = ${MAX_ANNUAL_GROWTH_BYTES - aBytes}
       where id = '${USER_ID}'
    `);

    const outcomes = await Promise.all([
      pushRecords(h.db, USER_ID, [a], PERIOD_START),
      pushRecords(h.db, USER_ID, [b], PERIOD_START),
    ]);
    expect(outcomes.filter((result) => result.applied === 1)).toHaveLength(1);
    expect(outcomes.flatMap((result) => result.rejectedRecords)).toEqual([
      expect.objectContaining({ code: "account_quota_exceeded" }),
    ]);
    const [usage] = await h.query<{ sync_growth_bytes: number }>(
      `select sync_growth_bytes from users where id = '${USER_ID}'`,
    );
    expect(Number(usage!.sync_growth_bytes)).toBeLessThanOrEqual(MAX_ANNUAL_GROWTH_BYTES);
  });

  it("accepts the fitting prefix, rejects only over-budget records, and skips stale replay", async () => {
    const first = habit("partial-a", "x", 2_000);
    const second = habit("partial-b", "y", 2_000);
    const firstBytes = await jsonBytes(first.data);
    await h.raw(`
      update users
         set sync_growth_period_started_at = '${PERIOD_START.toISOString()}',
             sync_growth_bytes = ${MAX_ANNUAL_GROWTH_BYTES - firstBytes}
       where id = '${USER_ID}'
    `);

    const partial = await pushRecords(h.db, USER_ID, [first, second], PERIOD_START);
    expect(partial).toMatchObject({
      applied: 1,
      skipped: 0,
      rejectedRecords: [
        {
          kind: "habits",
          id: "partial-b",
          updatedAt: 2_000,
          code: "account_quota_exceeded",
          retryAt: Date.parse("2027-09-01T00:00:00.000Z"),
        },
      ],
    });

    const staleReplay = await pushRecords(
      h.db,
      USER_ID,
      [habit("partial-a", "older", 1_000)],
      PERIOD_START,
    );
    expect(staleReplay).toMatchObject({ applied: 0, skipped: 1, rejectedRecords: [] });
    const rows = await h.query<{ id: string }>(`
      select id from records where user_id = '${USER_ID}' order by id
    `);
    expect(rows.map((row) => row.id)).toEqual(["partial-a"]);
  });

  it("still applies a later deletion after rejecting an earlier positive-growth row", async () => {
    const existing = habit("delete-me", "old", 1_000);
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values (
        '${USER_ID}', 'habits', 'delete-me',
        '${JSON.stringify(existing.data).replaceAll("'", "''")}'::jsonb,
        1000, false, 1
      );
      update users
         set seq = 1,
             sync_growth_period_started_at = '${PERIOD_START.toISOString()}',
             sync_growth_bytes = ${MAX_ANNUAL_GROWTH_BYTES}
       where id = '${USER_ID}'
    `);
    const deletion: PushRecord = {
      kind: "habits",
      id: "delete-me",
      data: null,
      updatedAt: 3_000,
      deleted: true,
    };

    const result = await pushRecords(
      h.db,
      USER_ID,
      [habit("too-large", "positive", 2_000), deletion],
      PERIOD_START,
    );
    expect(result).toMatchObject({
      applied: 1,
      skipped: 0,
      rejectedRecords: [
        expect.objectContaining({ id: "too-large", code: "account_quota_exceeded" }),
      ],
    });
    const [stored] = await h.query<{ deleted: boolean; data: unknown }>(`
      select deleted, data from records
       where user_id = '${USER_ID}' and kind = 'habits' and id = 'delete-me'
    `);
    expect(stored).toEqual({ deleted: true, data: null });
  });

  it("at 49,999 rows accepts updates/deletes and one safe insert while returning a daily row-cap retry only for the other insert", async () => {
    const existing = habit("row-update", "قدیمی", 1_000);
    const deleted = habit("row-delete", "برای حذف", 1_000);
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values
        ('${USER_ID}', 'habits', 'row-update', '${JSON.stringify(existing.data).replaceAll("'", "''")}'::jsonb, 1000, false, 1),
        ('${USER_ID}', 'habits', 'row-delete', '${JSON.stringify(deleted.data).replaceAll("'", "''")}'::jsonb, 1000, false, 2);
      update users set seq = 2, sync_record_count = 49999 where id = '${USER_ID}';
    `);

    const result = await pushRecords(
      h.db,
      USER_ID,
      [
        habit("row-new-a", "اول", 2_000),
        habit("row-new-b", "دوم", 2_000),
        habit("row-update", "ویرایش مجاز", 2_000),
        { kind: "habits", id: "row-delete", data: null, updatedAt: 2_000, deleted: true },
      ],
      PERIOD_START,
    );

    expect(result).toMatchObject({ applied: 3, skipped: 0 });
    expect(result.rejectedRecords).toEqual([
      expect.objectContaining({
        kind: "habits",
        id: "row-new-b",
        updatedAt: 2_000,
        code: "account_quota_exceeded",
        retryAt: PERIOD_START.getTime() + 24 * 60 * 60_000,
      }),
    ]);
    expect(
      await h.query<{ id: string; deleted: boolean }>(`
      select id, deleted from records where user_id = '${USER_ID}' order by id
    `),
    ).toEqual([
      { id: "row-delete", deleted: true },
      { id: "row-new-a", deleted: false },
      { id: "row-update", deleted: false },
    ]);
  });

  it("accepts a later smaller growth after an earlier record does not fit", async () => {
    const large = habit("greedy-large", "x".repeat(100), 2_000);
    const small = habit("greedy-small", "x", 2_000);
    const smallBytes = await jsonBytes(small.data);
    expect(await jsonBytes(large.data)).toBeGreaterThan(smallBytes);
    await h.raw(`
      update users
         set sync_growth_period_started_at = '${PERIOD_START.toISOString()}',
             sync_growth_bytes = ${MAX_ANNUAL_GROWTH_BYTES - smallBytes}
       where id = '${USER_ID}'
    `);

    const result = await pushRecords(h.db, USER_ID, [large, small], PERIOD_START);
    expect(result).toMatchObject({
      applied: 1,
      rejectedRecords: [
        expect.objectContaining({ id: "greedy-large", code: "account_quota_exceeded" }),
      ],
    });
    const rows = await h.query<{ id: string }>(`
      select id from records where user_id = '${USER_ID}' order by id
    `);
    expect(rows.map((row) => row.id)).toEqual(["greedy-small"]);
  });

  it("uses the original local timestamp in quota rejection identity after clock clamping", async () => {
    const originalUpdatedAt = PERIOD_START.getTime() + 86_400_000;
    await h.raw(`
      update users
         set sync_growth_period_started_at = '${PERIOD_START.toISOString()}',
             sync_growth_bytes = ${MAX_ANNUAL_GROWTH_BYTES}
       where id = '${USER_ID}'
    `);

    const result = await pushRecords(
      h.db,
      USER_ID,
      [habit("future-local", "future", originalUpdatedAt)],
      PERIOD_START,
    );
    expect(result.rejectedRecords).toEqual([
      expect.objectContaining({
        id: "future-local",
        updatedAt: originalUpdatedAt,
        code: "account_quota_exceeded",
      }),
    ]);
  });
});
