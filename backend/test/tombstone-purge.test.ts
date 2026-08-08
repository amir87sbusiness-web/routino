/**
 * The tombstone purge that pg_cron runs weekly, executed for real.
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
  const marker = "select cron.schedule('routino-tombstone-purge'";
  const start = setup.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const open = setup.indexOf("$$", start) + 2;
  const close = setup.indexOf("$$", open);
  expect(close).toBeGreaterThan(open);
  return setup.slice(open, close);
}

const DAY = 86_400_000;

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

describe("weekly tombstone purge", () => {
  it("drops old tombstones, keeps live rows, and raises the resync watermark", async () => {
    const { access, user } = await signIn("09124440001");

    await push(access, [
      { kind: "habits", id: "keep", data: { id: "keep" }, updatedAt: Date.now(), deleted: false },
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
      { kind: "habits", id: "alive", data: { id: "alive" }, updatedAt: Date.now(), deleted: false },
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
    await push(b.access, [
      {
        kind: "habits",
        id: "b-live",
        data: { id: "b-live" },
        updatedAt: Date.now(),
        deleted: false,
      },
    ]);

    await h.raw(purgeSql());

    const bRows = (await pull(b.access, 0)).json() as { records: { id: string }[] };
    expect(bRows.records.map((r) => r.id)).toContain("b-live");
  });
});
