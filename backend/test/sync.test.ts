/**
 * Delta sync: push, pull, and the three things that quietly corrupt a synced
 * account if they are wrong — conflict resolution, clock trust, and isolation
 * between users.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";
import {
  isAccountQuotaError,
  PULL_RESPONSE_MAX_UTF8_BYTES,
  selectPullPage,
  type PullRecord,
} from "../src/services/sync.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

async function signIn(phone: string) {
  await h.raw(`update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`);
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const code = h.sms.last()!.code;
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { access: string; user: { id: string } };
  return body;
}

const auth = (access: string) => ({ authorization: `Bearer ${access}` });

function push(access: string, records: unknown[]) {
  return h.app.inject({
    method: "POST",
    url: "/v1/sync/push",
    headers: auth(access),
    payload: { records },
  });
}

function pull(access: string, cursor = 0, limit?: number) {
  const q = limit ? `?cursor=${cursor}&limit=${limit}` : `?cursor=${cursor}`;
  return h.app.inject({ method: "GET", url: `/v1/sync/pull${q}`, headers: auth(access) });
}

function exchange(
  access: string,
  cursor: number,
  records: unknown[],
  includeAccountState = false,
  limit?: number,
) {
  return h.app.inject({
    method: "POST",
    url: "/v1/sync/exchange",
    headers: auth(access),
    payload: {
      protocolVersion: 2,
      cursor,
      records,
      includeAccountState,
      ...(limit ? { limit } : {}),
    },
  });
}

const habit = (id: string, name: string, updatedAt = 1000) => ({
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

const month = (
  habitId: string,
  days: { dateKey: string; updatedAt?: number; done?: boolean; deleted?: boolean }[],
) => {
  const cells = Object.fromEntries(
    days.map(({ dateKey, updatedAt = 1000, done = true, deleted = false }) => [
      dateKey.slice(8, 10),
      deleted
        ? { updatedAt, deleted: true }
        : { value: done ? 1 : 0, done, updatedAt, deleted: false },
    ]),
  );
  return {
    kind: "habitMonths",
    id: `${habitId}|${days[0]!.dateKey.slice(0, 7)}`,
    data: { habitId, monthKey: days[0]!.dateKey.slice(0, 7), cells },
    updatedAt: Math.max(...days.map((day) => day.updatedAt ?? 1000)),
    deleted: false,
  };
};

const archivedTask = (id: string, dateKey: string, updatedAt: number, title = "آرشیوی") => ({
  id,
  dateKey,
  title,
  type: "binary",
  target: 1,
  value: 0,
  done: false,
  updatedAt,
});

function taskArchive(
  monthKey: string,
  items: ReturnType<typeof archivedTask>[],
  version = 1,
) {
  return {
    v: version,
    monthKey,
    count: items.length,
    checksum: "a".repeat(32),
    items: items.map(({ updatedAt, ...item }) => [item.id, updatedAt, item]),
  };
}

async function allowTaskMonthArchives() {
  // The production migration that installs this future stored-only kind is not
  // part of this test fixture yet, so make only this test database accept it.
  await h.raw(`
    alter table records drop constraint records_kind_valid;
    alter table records add constraint records_kind_valid check (kind in
      ('categories','habits','habitMonths','tasks','timerSessions','journal','taskMonths'));
  `);
}

async function seedTaskArchive(
  userId: string,
  seq: number,
  id: string,
  data: ReturnType<typeof taskArchive>,
) {
  await h.raw(`
    insert into records (user_id, kind, id, data, updated_at, deleted, seq)
    values ('${userId}', 'taskMonths', '${id}', '${JSON.stringify(data)}'::jsonb,
            ${seq}, false, ${seq});
    update users set seq = greatest(seq, ${seq}) where id = '${userId}';
  `);
}

describe("sync", () => {
  it("keeps the next task archive atomic when its expanded rows exceed the remaining byte budget", () => {
    const first: PullRecord = {
      kind: "tasks",
      id: "before-archive",
      data: null,
      updatedAt: 1000,
      deleted: true,
      seq: 1,
    };
    const archive: PullRecord = {
      kind: "taskMonths",
      id: "2026-01|0001",
      data: taskArchive("2026-01", [archivedTask("t-next", "2026-01-02", 2000)]),
      updatedAt: 2000,
      deleted: false,
      seq: 2,
    };
    const onlyFirstFits = Buffer.byteLength(JSON.stringify([first]), "utf8") + 1;

    // A page boundary may never split an archive: otherwise returning cursor 2
    // would make the remaining expanded task unreachable forever.
    expect(selectPullPage([first, archive], 500, onlyFirstFits)).toMatchObject({
      records: [first],
      cursor: 1,
      hasMore: true,
      reset: false,
    });
  });

  it("expands task archives for fresh and existing cursors without leaking the stored kind", async () => {
    const a = await signIn("09120000030");
    const b = await signIn("09120000031");
    await allowTaskMonthArchives();
    await seedTaskArchive(
      a.user.id,
      1,
      "2026-01|0001",
      taskArchive("2026-01", [archivedTask("t-archived", "2026-01-02", 1000)]),
    );
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values ('${a.user.id}', 'tasks', 't-archived', null, 2000, true, 2);
      update users set seq = 2 where id = '${a.user.id}';
    `);

    const response = await pull(a.access, 0);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { records: PullRecord[]; cursor: number };
    expect(body.records).toEqual([
      expect.objectContaining({ kind: "tasks", id: "t-archived", updatedAt: 1000 }),
      expect.objectContaining({
        kind: "tasks",
        id: "t-archived",
        updatedAt: 2000,
        deleted: true,
      }),
    ]);
    expect(body.records.some((row) => row.kind === "taskMonths")).toBe(false);
    expect(Buffer.byteLength(response.body, "utf8")).toBeLessThanOrEqual(
      PULL_RESPONSE_MAX_UTF8_BYTES,
    );

    const existing = (await pull(a.access, 1)).json() as { records: PullRecord[] };
    expect(existing.records).toEqual([
      expect.objectContaining({ kind: "tasks", id: "t-archived", updatedAt: 2000, deleted: true }),
    ]);
    expect(((await pull(b.access, 0)).json() as { records: PullRecord[] }).records).toEqual([]);
  });

  it("pages whole task archive chunks and fails closed for an unsupported archive version", async () => {
    const { access, user } = await signIn("09120000032");
    await allowTaskMonthArchives();
    await seedTaskArchive(
      user.id,
      1,
      "2026-01|0001",
      taskArchive("2026-01", [
        archivedTask("t-1", "2026-01-02", 1000),
        archivedTask("t-2", "2026-01-03", 1001),
      ]),
    );
    await seedTaskArchive(
      user.id,
      2,
      "2026-02|0001",
      taskArchive("2026-02", [archivedTask("t-3", "2026-02-02", 1002)]),
    );

    const first = (await pull(access, 0, 1)).json() as {
      records: PullRecord[];
      cursor: number;
      hasMore: boolean;
    };
    expect(first.records.map((record) => record.id)).toEqual(["t-1", "t-2"]);
    expect(first.cursor).toBe(1);
    expect(first.hasMore).toBe(true);

    const second = (await pull(access, first.cursor, 1)).json() as { records: PullRecord[] };
    expect(second.records.map((record) => record.id)).toEqual(["t-3"]);

    await h.raw(`
      update records
         set data = jsonb_set(data, '{v}', '2'::jsonb)
       where user_id = '${user.id}' and kind = 'taskMonths' and id = '2026-02|0001';
    `);
    const malformed = await pull(access, 1, 1);
    expect(malformed.statusCode).toBe(500);
    expect((malformed.json() as { error: string }).error).toBe("internal");
  });

  it("recognises postgres-js quota constraints without swallowing unrelated database errors", () => {
    expect(
      isAccountQuotaError({
        cause: { code: "23514", constraint_name: "users_sync_data_bytes_bounds" },
      }),
    ).toBe(true);
    expect(isAccountQuotaError({ code: "23514", constraint_name: "some_other_check" })).toBe(false);
    expect(
      isAccountQuotaError({ code: "23505", constraint_name: "users_sync_data_bytes_bounds" }),
    ).toBe(false);
  });
  it("returns a bounded per-record quota refusal and keeps the rolled-back batch pullable", async () => {
    const { access, user } = await signIn("09120000027");
    await h.raw(`
      update users set sync_record_count = 49999 where id = '${user.id}'
    `);

    const response = await exchange(access, 0, [
      habit("quota-h1", "اول"),
      habit("quota-h2", "دوم"),
    ]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      applied: 0,
      skipped: 0,
      records: [],
      rejectedRecords: [
        { kind: "habits", id: "quota-h1", code: "account_quota_exceeded" },
        { kind: "habits", id: "quota-h2", code: "account_quota_exceeded" },
      ],
    });
    const [state] = await h.query<{ n: number; seq: number; sync_record_count: number }>(`
      select count(r.*)::integer as n, u.seq, u.sync_record_count
        from users u left join records r on r.user_id = u.id
       where u.id = '${user.id}'
       group by u.id
    `);
    expect(Number(state!.n)).toBe(0);
    expect(Number(state!.seq)).toBe(0);
    expect(Number(state!.sync_record_count)).toBe(49999);
  });

  it("accepts valid rows even when another row in the exchange is rejected", async () => {
    const { access } = await signIn("09120000019");
    const privateText = "private:" + "x".repeat(4_001);

    const response = await exchange(access, 0, [
      habit("h-valid", "ورزش"),
      {
        kind: "journal",
        id: "2026-08-31",
        data: {
          dateKey: "2026-08-31",
          text: privateText,
          score: null,
          mood: null,
          updatedAt: 1_000,
        },
        updatedAt: 1_000,
        deleted: false,
      },
    ]);

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      applied: number;
      records: { id: string }[];
      rejectedRecords: { kind: string; id: string; updatedAt: number; code: string }[];
    };
    expect(body.applied).toBe(1);
    expect(body.records.map((record) => record.id)).toContain("h-valid");
    expect(body.rejectedRecords).toEqual([
      {
        kind: "journal",
        id: "2026-08-31",
        updatedAt: 1_000,
        code: "record_too_large",
      },
    ]);
    expect(response.body).not.toContain(privateText);
  });

  it("pushes then pulls from the caller's original cursor in one exchange", async () => {
    const { access } = await signIn("09120000020");

    const response = await exchange(access, 0, [habit("h1", "ورزش")]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      applied: 1,
      skipped: 0,
      records: [expect.objectContaining({ id: "h1" })],
      hasMore: false,
      reset: false,
    });
    expect(response.json()).not.toHaveProperty("entitlement");
  });

  it("rejects an exchange that does not declare protocol v2", async () => {
    const { access } = await signIn("09120000026");
    const response = await h.app.inject({
      method: "POST",
      url: "/v1/sync/exchange",
      headers: auth(access),
      payload: { cursor: 0, records: [] },
    });
    expect(response.statusCode).toBe(400);
  });

  it("includes account state only when explicitly requested", async () => {
    const { access } = await signIn("09120000021");
    const response = await exchange(access, 0, [], true);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ entitlement: { status: "none" } });
  });

  it("gives a second device what the first one pushed", async () => {
    const { access } = await signIn("09120000001");

    const up = await push(access, [habit("h1", "ورزش"), habit("h2", "مطالعه")]);
    expect(up.statusCode).toBe(200);
    expect((up.json() as { applied: number }).applied).toBe(2);

    // A device that has never synced starts at cursor 0.
    const down = await pull(access, 0);
    const body = down.json() as {
      records: { id: string; data: { name: string } }[];
      cursor: number;
    };
    expect(body.records.map((r) => r.id).sort()).toEqual(["h1", "h2"]);
    expect(body.records.find((r) => r.id === "h1")!.data.name).toBe("ورزش");
    expect(body.cursor).toBeGreaterThan(0);
  });

  it("returns nothing when the device is already up to date", async () => {
    const { access } = await signIn("09120000002");
    await push(access, [habit("h1", "ورزش")]);

    const first = (await pull(access, 0)).json() as { cursor: number };
    const second = (await pull(access, first.cursor)).json() as {
      records: unknown[];
      hasMore: boolean;
    };

    // This is the whole point of the cursor: an idle device costs one empty
    // response, not a full download of its own history.
    expect(second.records).toEqual([]);
    expect(second.hasMore).toBe(false);
  });

  it("keeps the newer edit when two devices change the same record", async () => {
    const { access } = await signIn("09120000003");
    await push(access, [habit("h1", "جدیدتر", 5000)]);

    // The other device was offline and is replaying an OLDER edit.
    const late = await push(access, [habit("h1", "قدیمی‌تر", 4000)]);
    expect((late.json() as { applied: number; skipped: number }).skipped).toBe(1);

    const body = (await pull(access, 0)).json() as { records: { data: { name: string } }[] };
    expect(body.records[0]!.data.name).toBe("جدیدتر");
  });

  it("does not let a device with a wrong clock win every conflict forever", async () => {
    const { access } = await signIn("09120000004");
    const year2099 = Date.parse("2099-01-01T00:00:00Z");

    await push(access, [habit("h1", "از آینده", year2099)]);
    const body = (await pull(access, 0)).json() as { records: { updatedAt: number }[] };

    // Clamped to roughly now, so an ordinary edit tomorrow still beats it.
    expect(body.records[0]!.updatedAt).toBeLessThan(Date.now() + 120_000);
  });

  it("propagates deletes as tombstones", async () => {
    const { access } = await signIn("09120000005");
    await push(access, [habit("h1", "ورزش", 1000)]);
    await push(access, [{ kind: "habits", id: "h1", data: null, updatedAt: 2000, deleted: true }]);

    const body = (await pull(access, 0)).json() as { records: { id: string; deleted: boolean }[] };
    const row = body.records.find((r) => r.id === "h1")!;
    // A delete has to be a ROW. As an absence it could never reach the other
    // device, which would keep showing the habit forever.
    expect(row.deleted).toBe(true);
  });

  it("buries a habit's logs when the habit is deleted", async () => {
    const { access } = await signIn("09120000006");
    await push(access, [
      habit("h1", "ورزش", 1000),
      month("h1", [{ dateKey: "2026-08-01" }, { dateKey: "2026-08-02" }]),
      month("h2", [{ dateKey: "2026-08-01" }]),
    ]);

    // ONE tombstone for the habit — the client does not send one per log, which
    // for a year of history would be a 400-row push.
    await push(access, [{ kind: "habits", id: "h1", data: null, updatedAt: 2000, deleted: true }]);

    const body = (await pull(access, 0)).json() as {
      records: { kind: string; id: string; deleted: boolean }[];
    };
    const months = Object.fromEntries(
      body.records.filter((r) => r.kind === "habitMonths").map((r) => [r.id, r.deleted]),
    );
    expect(months["h1|2026-08"]).toBe(true);
    // Another habit's log with a similar-looking key must survive.
    expect(months["h2|2026-08"]).toBe(false);
  });

  it("clamps the timestamp inside every habit-month cell too", async () => {
    const { access } = await signIn("09120000024");
    const year2099 = Date.parse("2099-01-01T00:00:00Z");

    await push(access, [month("h1", [{ dateKey: "2026-08-01", updatedAt: year2099 }])]);
    const body = (await pull(access, 0)).json() as {
      records: { kind: string; data: { cells: Record<string, { updatedAt: number }> } }[];
    };
    const stored = body.records.find((record) => record.kind === "habitMonths")!;
    expect(stored.data.cells["01"]!.updatedAt).toBeLessThan(Date.now() + 120_000);
  });

  it("merges different days independently even when the later packet has an older envelope", async () => {
    const { access } = await signIn("09120000022");
    await push(access, [month("h1", [{ dateKey: "2026-08-01", updatedAt: 5000 }])]);

    const second = await push(access, [month("h1", [{ dateKey: "2026-08-02", updatedAt: 1000 }])]);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ applied: 1, skipped: 0 });

    const body = (await pull(access, 0)).json() as {
      records: { kind: string; data: { cells: Record<string, unknown> } }[];
    };
    const stored = body.records.find((record) => record.kind === "habitMonths")!;
    expect(Object.keys(stored.data.cells).sort()).toEqual(["01", "02"]);
  });

  it("uses per-day LWW and does not churn the stored row on an idempotent replay", async () => {
    const { access, user } = await signIn("09120000023");
    const newest = month("h1", [{ dateKey: "2026-08-01", updatedAt: 5000, done: true }]);
    await push(access, [newest]);
    const before = await h.query<{ seq: string }>(
      `select seq::text from records where user_id = '${user.id}' and kind = 'habitMonths'`,
    );

    const stale = await push(access, [
      month("h1", [{ dateKey: "2026-08-01", updatedAt: 4000, done: false }]),
    ]);
    const replay = await push(access, [newest]);
    expect(stale.json()).toMatchObject({ applied: 0, skipped: 1 });
    expect(replay.json()).toMatchObject({ applied: 0, skipped: 1 });

    const after = await h.query<{ seq: string }>(
      `select seq::text from records where user_id = '${user.id}' and kind = 'habitMonths'`,
    );
    expect(after[0]!.seq).toBe(before[0]!.seq);
    const body = (await pull(access, 0)).json() as {
      records: { kind: string; data: { cells: Record<string, { done: boolean }> } }[];
    };
    expect(
      body.records.find((record) => record.kind === "habitMonths")!.data.cells["01"]!.done,
    ).toBe(true);
  });

  it("never shows one user another user's data", async () => {
    const a = await signIn("09120000007");
    const b = await signIn("09120000008");

    await push(a.access, [habit("secret", "ژورنال خصوصی")]);

    const body = (await pull(b.access, 0)).json() as { records: unknown[] };
    expect(body.records).toEqual([]);
  });

  it("pages a large history instead of sending it all at once", async () => {
    const { access } = await signIn("09120000009");
    const many = Array.from({ length: 12 }, (_, i) => habit(`h${i}`, `عادت ${i}`));
    await push(access, many);

    const first = (await pull(access, 0, 5)).json() as {
      records: unknown[];
      hasMore: boolean;
      cursor: number;
    };
    expect(first.records).toHaveLength(5);
    expect(first.hasMore).toBe(true);

    // Walk the pages the way the client does, and confirm nothing is lost or
    // repeated at a page boundary.
    const seen = new Set<string>();
    let cursor = 0;
    let hasMore = true;
    while (hasMore) {
      const page = (await pull(access, cursor, 5)).json() as {
        records: { id: string }[];
        hasMore: boolean;
        cursor: number;
      };
      for (const r of page.records) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      cursor = page.cursor;
      hasMore = page.hasMore;
    }
    expect(seen.size).toBe(12);
  });

  it("bounds each pull by UTF-8 bytes and still eventually returns every large row", async () => {
    const { access, user } = await signIn("09120000029");
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      select '${user.id}', 'journal', 'large-' || n,
             jsonb_build_object('text', repeat('x', 40000)), n, false, n
        from generate_series(1, 20) n;
      update users set seq = 20 where id = '${user.id}';
    `);

    const seen = new Set<string>();
    let cursor = 0;
    let hasMore = true;
    while (hasMore) {
      const response = await pull(access, cursor);
      expect(Buffer.byteLength(response.body, "utf8")).toBeLessThanOrEqual(
        PULL_RESPONSE_MAX_UTF8_BYTES,
      );
      const page = response.json() as {
        records: { id: string }[];
        cursor: number;
        hasMore: boolean;
      };
      expect(page.records.length).toBeGreaterThan(0);
      for (const record of page.records) {
        expect(seen.has(record.id)).toBe(false);
        seen.add(record.id);
      }
      cursor = page.cursor;
      hasMore = page.hasMore;
    }
    expect(seen.size).toBe(20);
  });

  it("tells a device that fell behind the tombstone purge to start over", async () => {
    const { access, user } = await signIn("09120000010");
    await push(access, [habit("h1", "ورزش")]);

    // Simulate a GC that purged tombstones up to seq 50 while this device sat
    // at 1. Continuing from there would RESURRECT whatever was deleted below
    // the line, which is the one outcome sync must never produce.
    await h.raw(`update users set gc_seq = 50 where id = '${user.id}'`);

    const body = (await pull(access, 1)).json() as { reset: boolean; records: unknown[] };
    expect(body.reset).toBe(true);

    // A brand-new device is exempt: it has nothing to resurrect.
    expect(((await pull(access, 0)).json() as { reset: boolean }).reset).toBe(false);
  });

  it("refuses records it cannot store safely", async () => {
    const { access } = await signIn("09120000011");

    const rejectedCode = (response: { statusCode: number; json(): unknown }) => {
      expect(response.statusCode).toBe(200);
      const body = response.json() as { applied: number; rejectedRecords: { code: string }[] };
      expect(body.applied).toBe(0);
      expect(body.rejectedRecords).toHaveLength(1);
      return body.rejectedRecords[0]!.code;
    };

    const badKind = await push(access, [{ ...habit("h1", "x"), kind: "passwords" }]);
    expect(rejectedCode(badKind)).toBe("bad_kind");

    const badId = await push(access, [{ ...habit("h1", "x"), id: "a/../../etc/passwd" }]);
    expect(rejectedCode(badId)).toBe("bad_id");

    const huge = await push(access, [
      {
        kind: "journal",
        id: "2026-08-01",
        data: { text: "ب".repeat(20_000) },
        updatedAt: 1,
        deleted: false,
      },
    ]);
    expect(rejectedCode(huge)).toBe("record_too_large");
  });

  it("survives a habit tombstone that repeats a log the client also sent", async () => {
    const { access } = await signIn("09120000012");

    // A month exists on the server, so the habit delete will try to cascade it.
    await push(access, [month("h1", [{ dateKey: "2026-08-01", updatedAt: 1000 }])]);

    // The client deletes the habit AND happens to send that same log itself.
    // Both name (habitMonths, h1|2026-08), and an INSERT … ON CONFLICT DO UPDATE
    // that touches one key twice is a hard Postgres error — which would 500 a
    // push the client then retries forever, wedging sync for this account.
    const res = await push(access, [
      { kind: "habits", id: "h1", data: null, updatedAt: 2000, deleted: true },
      { kind: "habitMonths", id: "h1|2026-08", data: null, updatedAt: 2000, deleted: true },
    ]);
    expect(res.statusCode).toBe(200);

    const down = (await pull(access, 0)).json() as { records: { id: string; deleted: boolean }[] };
    expect(down.records.find((r) => r.id === "h1|2026-08")!.deleted).toBe(true);
  });

  it("lets the habit-delete cascade beat a live month packet on an exact tie", async () => {
    const { access } = await signIn("09120000025");
    await push(access, [month("h1", [{ dateKey: "2026-08-01", updatedAt: 1000 }])]);

    const res = await push(access, [
      { kind: "habits", id: "h1", data: null, updatedAt: 2000, deleted: true },
      month("h1", [{ dateKey: "2026-08-02", updatedAt: 2000 }]),
    ]);
    expect(res.statusCode).toBe(200);

    const body = (await pull(access, 0)).json() as {
      records: { kind: string; id: string; deleted: boolean }[];
    };
    expect(body.records.find((record) => record.id === "h1|2026-08")).toMatchObject({
      kind: "habitMonths",
      deleted: true,
    });
  });

  it("carries the entitlement on the last page and only there", async () => {
    const { access } = await signIn("09120000013");
    const activated = await h.app.inject({
      method: "POST",
      url: "/v1/subscriptions/trial/start",
      headers: auth(access),
    });
    expect(activated.statusCode).toBe(200);
    await push(access, [habit("h1", "ورزش"), habit("h2", "مطالعه")]);

    // The app reads its paywall from this instead of calling
    // GET /subscriptions/me, which is one fewer Supabase invocation on every
    // single app open. Invocations are what the free tier runs out of first, so
    // this is a cost guarantee, not a convenience.
    const last = (await pull(access, 0)).json() as {
      hasMore: boolean;
      entitlement?: { status: string };
    };
    expect(last.hasMore).toBe(false);
    expect(last.entitlement?.status).toBe("active");

    // A first sync of a year of history is several pages and the answer is the
    // same on each, so the earlier pages must not pay for it.
    const paged = (await pull(access, 0, 1)).json() as {
      hasMore: boolean;
      entitlement?: unknown;
    };
    expect(paged.hasMore).toBe(true);
    expect(paged.entitlement).toBeUndefined();
  });

  it("requires a signed-in user", async () => {
    expect((await h.app.inject({ method: "GET", url: "/v1/sync/pull?cursor=0" })).statusCode).toBe(
      401,
    );
    expect(
      (await h.app.inject({ method: "POST", url: "/v1/sync/push", payload: { records: [] } }))
        .statusCode,
    ).toBe(401);
  });
});
