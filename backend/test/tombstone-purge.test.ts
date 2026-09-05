/**
 * The bounded tombstone purge that pg_cron runs frequently, executed for real.
 *
 * It reads the statement out of `supabase/setup.sql` rather than restating it,
 * because the whole risk with a scheduled job is that nobody ever watches it:
 * a syntax error, a renamed column, a wrong unit — pg_cron records the failure
 * in a table nobody opens and the disk quietly fills. Running the production
 * text here means the schedule cannot drift away from something that works.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

/** The exact body pg_cron is scheduled with. */
function purgeSql(): string {
  const setup = readFileSync(
    fileURLToPath(new URL("../../supabase/setup.sql", import.meta.url)),
    "utf8",
  );
  const marker = "select cron.schedule(\n  'routino-tombstone-purge',";
  const start = setup.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const open = setup.indexOf("$$", start) + 2;
  const close = setup.indexOf("$$", open);
  expect(close).toBeGreaterThan(open);
  return setup.slice(open, close);
}

const DAY = 86_400_000;

const habit = (id: string) => ({
  kind: "habits",
  id,
  data: {
    id,
    name: id,
    categoryId: "c1",
    type: "binary",
    target: 1,
    schedule: { kind: "daily" },
    monthlyGoal: null,
    reminderTime: null,
    createdAt: 1,
  },
  updatedAt: Date.now(),
  deleted: false,
});

async function signIn(phone: string) {
  await h.raw(`update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`);
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  return res.json() as { access: string; user: { id: string } };
}

const auth = (access: string) => ({ authorization: `Bearer ${access}` });

const push = (access: string, records: unknown[]) =>
  h.app.inject({
    method: "POST",
    url: "/v1/sync/push",
    headers: auth(access),
    payload: { records },
  });

const pull = (access: string, cursor: number) =>
  h.app.inject({ method: "GET", url: `/v1/sync/pull?cursor=${cursor}`, headers: auth(access) });

describe("bounded tombstone purge", () => {
  it("drains old tombstones in deterministic batches and advances each affected watermark", async () => {
    const a = await signIn("09124440006");
    const b = await signIn("09124440007");
    const ago = (days: number) => Date.now() - days * DAY;

    await push(a.access, [
      habit("a-live"),
      { kind: "habits", id: "a-old-1", data: null, updatedAt: ago(210), deleted: true },
      { kind: "habits", id: "a-old-2", data: null, updatedAt: ago(208), deleted: true },
      { kind: "habits", id: "a-old-3", data: null, updatedAt: ago(206), deleted: true },
      { kind: "habits", id: "a-recent", data: null, updatedAt: ago(3), deleted: true },
    ]);
    await push(b.access, [
      habit("b-live"),
      { kind: "habits", id: "b-old-1", data: null, updatedAt: ago(209), deleted: true },
      { kind: "habits", id: "b-old-2", data: null, updatedAt: ago(207), deleted: true },
      { kind: "habits", id: "b-old-3", data: null, updatedAt: ago(205), deleted: true },
      { kind: "habits", id: "b-old-4", data: null, updatedAt: ago(204), deleted: true },
      { kind: "habits", id: "b-recent", data: null, updatedAt: ago(2), deleted: true },
    ]);

    const counts = async () => {
      const [row] = await h.query<{ old: number; recent: number; live: number }>(`
        select
          count(*) filter (
            where deleted and updated_at < (extract(epoch from now()) * 1000)::bigint
              - 90 * 86400000::bigint
          )::integer as old,
          count(*) filter (
            where deleted and updated_at >= (extract(epoch from now()) * 1000)::bigint
              - 90 * 86400000::bigint
          )::integer as recent,
          count(*) filter (where not deleted)::integer as live
        from records
       where user_id in ('${a.user.id}', '${b.user.id}')
      `);
      return { old: Number(row!.old), recent: Number(row!.recent), live: Number(row!.live) };
    };
    const watermarks = async () =>
      h.query<{ id: string; gc_seq: number }>(`
        select id::text as id, gc_seq::integer as gc_seq
          from users where id in ('${a.user.id}', '${b.user.id}') order by id
      `);

    const before = await counts();
    const [first] = await h.query<{ purged_records: number; affected_users: number }>(
      "select * from routino_purge_tombstones(now(), 3)",
    );

    expect(Number(first!.purged_records)).toBe(3);
    expect(Number(first!.affected_users)).toBe(2);
    expect((await counts()).old).toBe(before.old - 3);
    expect((await counts()).live).toBe(before.live);
    expect((await counts()).recent).toBe(before.recent);
    expect(await watermarks()).toEqual(
      [
        { id: a.user.id, gc_seq: 3 },
        { id: b.user.id, gc_seq: 2 },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    expect(((await pull(a.access, 1)).json() as { reset: boolean }).reset).toBe(true);

    const [second] = await h.query<{ purged_records: number }>(
      "select * from routino_purge_tombstones(now(), 3)",
    );
    const [third] = await h.query<{ purged_records: number }>(
      "select * from routino_purge_tombstones(now(), 3)",
    );
    expect(Number(second!.purged_records)).toBe(3);
    expect(Number(third!.purged_records)).toBe(1);
    expect((await counts()).old).toBe(0);
    expect((await counts()).live).toBe(before.live);
    expect((await counts()).recent).toBe(before.recent);
    expect(await watermarks()).toEqual(
      [
        { id: a.user.id, gc_seq: 4 },
        { id: b.user.id, gc_seq: 5 },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const beforeEmptyRun = { counts: await counts(), watermarks: await watermarks() };
    const [empty] = await h.query<{ purged_records: number; affected_users: number }>(
      "select * from routino_purge_tombstones(now(), 3)",
    );
    expect({
      purgedRecords: Number(empty!.purged_records),
      affectedUsers: Number(empty!.affected_users),
    }).toEqual({ purgedRecords: 0, affectedUsers: 0 });
    expect({ counts: await counts(), watermarks: await watermarks() }).toEqual(beforeEmptyRun);
  });

  it("drops old tombstones, keeps live rows, and raises the resync watermark", async () => {
    const { access, user } = await signIn("09124440001");

    await push(access, [
      habit("keep"),
      {
        kind: "habits",
        id: "old-delete",
        data: null,
        updatedAt: Date.now() - 200 * DAY,
        deleted: true,
      },
      {
        kind: "habits",
        id: "recent-delete",
        data: null,
        updatedAt: Date.now() - 3 * DAY,
        deleted: true,
      },
    ]);

    const before = (await pull(access, 0)).json() as { records: { id: string }[]; cursor: number };
    expect(before.records.map((r) => r.id).sort()).toEqual(["keep", "old-delete", "recent-delete"]);

    await h.raw(purgeSql());

    const after = (await pull(access, 0)).json() as { records: { id: string }[] };
    // The 200-day-old tombstone is gone; the live row and the fresh tombstone stay.
    expect(after.records.map((r) => r.id).sort()).toEqual(["keep", "recent-delete"]);

    // And the watermark moved, which is the half that makes deleting it safe.
    const [row] = await h.query<{ gc_seq: string }>(
      `select gc_seq::text from users where id = '${user.id}'`,
    );
    expect(Number(row!.gc_seq)).toBeGreaterThan(0);
  });

  it("tells a device that fell behind the watermark to resync from scratch", async () => {
    const { access } = await signIn("09124440002");

    // Order matters: seq is assigned in array order, so the tombstone lands at
    // seq 2 and the purge lifts the watermark to 2. A device at cursor 1 is then
    // genuinely behind it. (A device at cursor 2 would NOT be — it already saw
    // the tombstone, which is why the check is a strict `cursor < gc_seq`.)
    await push(access, [
      habit("alive"),
      { kind: "habits", id: "gone", data: null, updatedAt: Date.now() - 200 * DAY, deleted: true },
    ]);
    await h.raw(purgeSql());

    // A phone that was in a drawer, still holding an old cursor. Continuing from
    // there would silently RESURRECT the habit whose tombstone was just purged.
    const stale = (await pull(access, 1)).json() as { reset: boolean; records: unknown[] };
    expect(stale.reset).toBe(true);
    expect(stale.records).toHaveLength(0);

    // Starting over is always allowed and returns the true current state.
    const fresh = (await pull(access, 0)).json() as { records: { id: string }[] };
    expect(fresh.records.map((r) => r.id)).toEqual(["alive"]);
  });

  it("never touches another user's rows", async () => {
    const a = await signIn("09124440003");
    const b = await signIn("09124440004");

    await push(a.access, [
      { kind: "habits", id: "a-old", data: null, updatedAt: Date.now() - 200 * DAY, deleted: true },
    ]);
    await push(b.access, [habit("b-live")]);

    await h.raw(purgeSql());

    const bRows = (await pull(b.access, 0)).json() as { records: { id: string }[] };
    expect(bRows.records.map((r) => r.id)).toContain("b-live");
  });
});

describe("purge racing a device that is syncing", () => {
  it("never lets a pull miss a delete the purge is removing", async () => {
    const { access } = await signIn("09124440005");

    await push(access, [
      habit("alive"),
      { kind: "habits", id: "old", data: null, updatedAt: Date.now() - 200 * DAY, deleted: true },
    ]);

    // A phone syncing at the exact moment the weekly job runs. Either outcome is
    // acceptable — the pull sees the tombstone, or it is told to resync — but
    // one is NOT: continuing from a cursor below the new watermark while the
    // tombstone is gone, which resurrects a deleted habit.
    const [, pulled] = await Promise.all([h.raw(purgeSql()), pull(access, 1)]);
    const body = pulled.json() as { reset: boolean; records: { id: string }[] };

    const sawTombstone = body.records.some((r) => r.id === "old");
    expect(body.reset || sawTombstone).toBe(true);

    // And afterwards a full resync shows the true state: the delete stuck.
    const fresh = (await pull(access, 0)).json() as { records: { id: string }[] };
    expect(fresh.records.map((r) => r.id)).toEqual(["alive"]);
  });
});
