/**
 * Delta sync against the deployed EDGE app.
 *
 * The service itself is covered by `backend/test/sync.test.ts` and is copied
 * verbatim by `npm run sync:edge`. What this file exists for is the part no
 * generator checks: `supabase/functions/api/routes/sync.ts` and its registration
 * in `app.ts` are hand-written. Forget either and the backend suite still passes
 * while production has no sync endpoints at all — so these tests are the only
 * thing standing between that mistake and a deploy.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { auth, makeHarness, signIn, type Harness } from "./helpers/harness.ts";
import {
  isAccountQuotaError,
  isLegacyAccountQuotaError,
  isUndefinedRoutinoPushRecordsError,
  PULL_RESPONSE_MAX_UTF8_BYTES,
  type PullRecord,
} from "../functions/api/shared/services/sync.ts";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
});
afterAll(async () => {
  await h?.close();
});

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

const task = (id: string, dateKey: string, updatedAt: number, title = "مطالعه") => ({
  id,
  dateKey,
  title,
  type: "binary" as const,
  target: 1,
  value: 1,
  done: true,
  updatedAt,
});

const md5 = (value: string) => createHash("md5").update(value).digest("hex");
const postgresJsonbText = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}: ${postgresJsonbText(item)}`)
      .join(", ")}}`;
  }
  return JSON.stringify(value);
};

function taskArchive(monthKey: string, items: ReturnType<typeof task>[]) {
  const sorted = [...items].sort((left, right) => left.id.localeCompare(right.id));
  const archiveItems = sorted.map(({ updatedAt, ...data }) => [data.id, updatedAt, data] as const);
  return {
    v: 1,
    monthKey,
    count: archiveItems.length,
    checksum: md5(
      archiveItems
        .map(([id, updatedAt, data]) => `${id}\n${updatedAt}\n${postgresJsonbText(data)}`)
        .join("\n"),
    ),
    items: archiveItems,
  };
}

function taskArchiveId(data: ReturnType<typeof taskArchive>) {
  return `${data.monthKey}|${md5(data.items.map(([id]) => id).join("\n"))}`;
}

async function seedTaskArchive(
  userId: string,
  seq: number,
  _id: string,
  data: ReturnType<typeof taskArchive>,
) {
  const id = taskArchiveId(data);
  const updatedAt = Math.max(...data.items.map(([, itemUpdatedAt]) => itemUpdatedAt));
  const encoded = JSON.stringify(data).replaceAll("'", "''");
  await h.raw(`
    insert into records (user_id, kind, id, data, updated_at, deleted, seq)
    values ('${userId}', 'taskMonths', '${id}', '${encoded}'::jsonb, ${updatedAt}, false, ${seq});
    update users set seq = greatest(seq, ${seq}) where id = '${userId}';
  `);
}

describe("edge sync", () => {
  it("uses the current quota writer only for cursor-zero when the cursor gate is not installed", async () => {
    const rollout = await makeHarness();
    try {
      await rollout.raw(
        `drop function routino_sync_push_if_current(uuid, timestamptz, jsonb, bigint)`,
      );
      const { access, user } = await signIn(rollout, "09120001127");

      const fresh = await rollout.call("POST", "/v1/sync/exchange", {
        headers: auth(access),
        body: {
          protocolVersion: 2,
          cursor: 0,
          records: [habit("gate-rollout-fresh", "سالم")],
          includeAccountState: false,
        },
      });
      expect(fresh.status).toBe(200);
      expect(await fresh.json()).toMatchObject({ applied: 1, batchAccepted: true });

      const nonzero = await rollout.call("POST", "/v1/sync/exchange", {
        headers: auth(access),
        body: {
          protocolVersion: 2,
          cursor: 1,
          records: [habit("gate-rollout-nonzero", "نباید نوشته شود")],
          includeAccountState: false,
        },
      });
      expect(nonzero.status).toBe(500);

      await rollout.raw(`
        update users
           set sync_growth_period_started_at = now(),
               sync_growth_bytes = 10485760
         where id = '${user.id}'
      `);
      const quota = await rollout.call("POST", "/v1/sync/exchange", {
        headers: auth(access),
        body: {
          protocolVersion: 2,
          cursor: 0,
          records: [habit("gate-rollout-quota", "سهمیه دور نخورد")],
          includeAccountState: false,
        },
      });
      expect(quota.status).toBe(200);
      expect(await quota.json()).toMatchObject({
        applied: 0,
        batchAccepted: true,
        rejectedRecords: [expect.objectContaining({ code: "account_quota_exceeded" })],
      });
    } finally {
      await rollout.close();
    }
  });

  it("keeps non-empty public sync working when code is deployed before the archive quota migration", async () => {
    const legacy = await makeHarness();
    try {
      await legacy.raw(`
        drop function routino_push_records(uuid, timestamptz, jsonb);
        alter table records drop constraint records_kind_valid;
        alter table records add constraint records_kind_valid check (kind in
          ('categories','habits','habitMonths','tasks','timerSessions','journal'));
        alter table users drop constraint users_sync_growth_bytes_bounds;
        alter table users drop column sync_growth_bytes;
        alter table users drop column sync_growth_period_started_at;
      `);
      const { access } = await signIn(legacy, "09120001129");

      const response = await legacy.call("POST", "/v1/sync/exchange", {
        headers: auth(access),
        body: {
          protocolVersion: 2,
          cursor: 0,
          records: [habit("legacy-schema-habit", "سازگار")],
          includeAccountState: false,
        },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        applied: 1,
        skipped: 0,
        records: [expect.objectContaining({ kind: "habits", id: "legacy-schema-habit" })],
      });
    } finally {
      await legacy.close();
    }
  });

  it("fails closed when a missing writer meets a partially migrated annual schema", async () => {
    const partial = await makeHarness();
    try {
      await partial.raw(`
        drop function routino_push_records(uuid, timestamptz, jsonb);
        alter table users drop column sync_growth_period_started_at;
      `);
      const { access } = await signIn(partial, "09120001128");
      const response = await partial.call("POST", "/v1/sync/exchange", {
        headers: auth(access),
        body: {
          protocolVersion: 2,
          cursor: 0,
          records: [habit("partial-annual", "نباید دور زده شود")],
          includeAccountState: false,
        },
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: "internal" });
    } finally {
      await partial.close();
    }
  });

  it("only accepts the nested undefined-function error for this exact writer", () => {
    expect(
      isUndefinedRoutinoPushRecordsError({
        cause: {
          code: "42883",
          message: "function routino_push_records(uuid, timestamptz, jsonb) does not exist",
        },
      }),
    ).toBe(true);
    expect(
      isUndefinedRoutinoPushRecordsError({
        code: "42883",
        message: "function other_writer() does not exist",
      }),
    ).toBe(false);
    expect(
      isUndefinedRoutinoPushRecordsError({
        code: "23505",
        message: "function routino_push_records() does not exist",
      }),
    ).toBe(false);
  });

  it("recognises only nested legacy row and data-byte quota constraints", () => {
    expect(
      isLegacyAccountQuotaError({
        cause: { code: "23514", constraint_name: "users_sync_record_count_bounds" },
      }),
    ).toBe(true);
    expect(
      isLegacyAccountQuotaError({ code: "23514", constraint: "users_sync_data_bytes_bounds" }),
    ).toBe(true);
    expect(
      isLegacyAccountQuotaError({
        code: "23514",
        constraint_name: "users_sync_growth_bytes_bounds",
      }),
    ).toBe(false);
    expect(
      isLegacyAccountQuotaError({ code: "23505", constraint: "users_sync_data_bytes_bounds" }),
    ).toBe(false);
  });

  it("expands internal task months and lets a newer ordinary override converge", async () => {
    const { access, user } = await signIn(h, "09120001130");
    await seedTaskArchive(
      user.id,
      1,
      "2026-01|0001",
      taskArchive("2026-01", [task("t-archived", "2026-01-02", 1_000)]),
    );
    await h.raw(`
      insert into records (user_id, kind, id, data, updated_at, deleted, seq)
      values ('${user.id}', 'tasks', 't-archived', null, 2000, true, 2);
      update users set seq = 2 where id = '${user.id}';
    `);

    const fresh = await h.call("GET", "/v1/sync/pull?cursor=0", { headers: auth(access) });
    expect(fresh.status).toBe(200);
    const body = (await fresh.json()) as { records: PullRecord[] };
    expect(body.records).toEqual([
      expect.objectContaining({ kind: "tasks", id: "t-archived", updatedAt: 1_000 }),
      expect.objectContaining({
        kind: "tasks",
        id: "t-archived",
        updatedAt: 2_000,
        deleted: true,
      }),
    ]);
    expect(body.records.some((row) => row.kind === "taskMonths")).toBe(false);
  });

  it("keeps expanded archive responses inside the public byte ceiling", async () => {
    const { access, user } = await signIn(h, "09120001131");
    const tasks = Array.from({ length: 32 }, (_, index) => ({
      ...task(`bounded-${index}`, "2026-01-02", 1_000 + index),
      note: "ی".repeat(4_000),
    }));
    await seedTaskArchive(user.id, 1, "2026-01|bounded", taskArchive("2026-01", tasks));

    const response = await h.call("POST", "/v1/sync/exchange", {
      headers: auth(access),
      body: { protocolVersion: 2, cursor: 0, records: [], includeAccountState: false },
    });

    expect(response.status).toBe(200);
    const body = (await response.clone().json()) as { records: PullRecord[] };
    expect(body.records).toHaveLength(32);
    expect(body.records.every((row) => row.kind === "tasks")).toBe(true);
    expect(Buffer.byteLength(await response.text(), "utf8")).toBeLessThanOrEqual(
      PULL_RESPONSE_MAX_UTF8_BYTES,
    );
  });

  it("returns bounded annual quota metadata with retryAt", async () => {
    const { access, user } = await signIn(h, "09120001132");
    await h.raw(`
      update users
         set sync_growth_period_started_at = now(),
             sync_growth_bytes = 10 * 1024 * 1024
       where id = '${user.id}'
    `);

    const response = await h.call("POST", "/v1/sync/exchange", {
      headers: auth(access),
      body: {
        protocolVersion: 2,
        cursor: 0,
        records: [habit("annual-limit", "بیش از سهمیه")],
        includeAccountState: false,
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.clone().json()) as {
      rejectedRecords: Array<Record<string, unknown>>;
    };
    expect(body.rejectedRecords).toEqual([
      expect.objectContaining({
        kind: "habits",
        id: "annual-limit",
        updatedAt: 1_000,
        code: "account_quota_exceeded",
        retryAt: expect.any(Number),
      }),
    ]);
    expect(Buffer.byteLength(await response.text(), "utf8")).toBeLessThan(1_024);
  });

  it("recognises postgres-js quota errors without broadening the safe mapping", () => {
    expect(
      isAccountQuotaError({
        cause: { code: "23514", constraint_name: "users_sync_growth_bytes_bounds" },
      }),
    ).toBe(true);
    expect(
      isAccountQuotaError({ code: "23514", constraint: "users_sync_record_count_bounds" }),
    ).toBe(true);
    expect(isAccountQuotaError({ code: "23514", constraint_name: "unrelated_check" })).toBe(false);
    expect(
      isAccountQuotaError({ code: "23505", constraint_name: "users_sync_growth_bytes_bounds" }),
    ).toBe(false);
  });

  it("exchanges local and remote changes in one authenticated invocation", async () => {
    const { access } = await signIn(h, "09120001123");
    const response = await h.call("POST", "/v1/sync/exchange", {
      headers: auth(access),
      body: {
        protocolVersion: 2,
        cursor: 0,
        records: [habit("h1", "ورزش")],
        includeAccountState: false,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      applied: 1,
      skipped: 0,
      records: [expect.objectContaining({ id: "h1" })],
    });
  });

  it("rejects exchange clients that do not declare protocol v2", async () => {
    const { access } = await signIn(h, "09120001124");
    const response = await h.call("POST", "/v1/sync/exchange", {
      headers: auth(access),
      body: { cursor: 0, records: [] },
    });
    expect(response.status).toBe(400);
  });

  it("keeps authenticated personal sync available", async () => {
    const localOnly = await makeHarness();
    try {
      const { access } = await signIn(localOnly, "09120001122");
      const headers = auth(access);
      const push = await localOnly.call("POST", "/v1/sync/push", {
        headers,
        body: { records: [] },
      });
      const pull = await localOnly.call("GET", "/v1/sync/pull?cursor=0", { headers });
      expect(push.status).toBe(200);
      expect(pull.status).toBe(200);
      expect(await push.json()).toMatchObject({ applied: 0 });
      expect(await pull.json()).toMatchObject({ records: [], reset: false });
    } finally {
      await localOnly.close();
    }
  });

  it("round-trips a record through push and pull", async () => {
    const { access } = await signIn(h, "09123334444");

    const up = await h.call("POST", "/v1/sync/push", {
      headers: auth(access),
      body: { records: [habit("h1", "ورزش")] },
    });
    expect(up.status).toBe(200);
    expect((await up.json()).applied).toBe(1);

    const down = await h.call("GET", "/v1/sync/pull?cursor=0", { headers: auth(access) });
    expect(down.status).toBe(200);
    const body = await down.json();
    expect(body.records).toHaveLength(1);
    expect(body.records[0].data.name).toBe("ورزش");
    expect(body.cursor).toBeGreaterThan(0);
  });

  it("defaults a missing cursor to the beginning", async () => {
    const { access } = await signIn(h, "09123334444");
    await h.call("POST", "/v1/sync/push", {
      headers: auth(access),
      body: { records: [habit("h1", "ورزش")] },
    });

    // Hono hands `undefined` to the parser when the query string is absent,
    // which is a different code path from `?cursor=0` and the one a fresh client
    // actually hits.
    const res = await h.call("GET", "/v1/sync/pull", { headers: auth(access) });
    expect(res.status).toBe(200);
    expect((await res.json()).records).toHaveLength(1);
  });

  it("keeps one account's records away from another", async () => {
    const a = await signIn(h, "09123334444");
    await h.call("POST", "/v1/sync/push", {
      headers: auth(a.access),
      body: { records: [habit("secret", "خصوصی")] },
    });

    const b = await signIn(h, "09121112222");
    const res = await h.call("GET", "/v1/sync/pull?cursor=0", { headers: auth(b.access) });
    expect((await res.json()).records).toEqual([]);
  });

  it("guards both endpoints behind sign-in", async () => {
    expect((await h.call("GET", "/v1/sync/pull?cursor=0")).status).toBe(401);
    expect((await h.call("POST", "/v1/sync/push", { body: { records: [] } })).status).toBe(401);
  });
});
