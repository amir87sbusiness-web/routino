import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

const USER_ID = "00000000-0000-4000-8000-000000000001";
const MAX_RECORDS = 50_000;
const MAX_DATA_BYTES = 128 * 1024 * 1024;

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

  it("rejects direct writes above the byte ceiling while allowing zero-byte tombstones", async () => {
    await h.raw(`
      update users set sync_data_bytes = ${MAX_DATA_BYTES} where id = '${USER_ID}';
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values ('${USER_ID}', 'habits', 'tombstone', null, 1, true, 1)
    `);

    await expect(
      h.raw(`
        insert into records (user_id, kind, id, data, updated_at, deleted, seq)
        values ('${USER_ID}', 'habits', 'overflow', '{"name":"blocked"}'::jsonb, 1, false, 2)
      `),
    ).rejects.toThrow(/users_sync_data_bytes_bounds/i);

    const rows = await h.query<{ id: string }>(`
      select id from records where user_id = '${USER_ID}' order by id
    `);
    expect(rows.map((row) => row.id)).toEqual(["tombstone"]);
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
});
