/**
 * Delta sync: push, pull, and the three things that quietly corrupt a synced
 * account if they are wrong — conflict resolution, clock trust, and isolation
 * between users.
 */
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

const habit = (id: string, name: string, updatedAt = 1000) => ({
  kind: "habits",
  id,
  data: { id, name },
  updatedAt,
  deleted: false,
});

describe("sync", () => {
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
      { kind: "logs", id: "h1|2026-08-01", data: { done: true }, updatedAt: 1000, deleted: false },
      { kind: "logs", id: "h1|2026-08-02", data: { done: true }, updatedAt: 1000, deleted: false },
      { kind: "logs", id: "h2|2026-08-01", data: { done: true }, updatedAt: 1000, deleted: false },
    ]);

    // ONE tombstone for the habit — the client does not send one per log, which
    // for a year of history would be a 400-row push.
    await push(access, [{ kind: "habits", id: "h1", data: null, updatedAt: 2000, deleted: true }]);

    const body = (await pull(access, 0)).json() as {
      records: { kind: string; id: string; deleted: boolean }[];
    };
    const logs = Object.fromEntries(
      body.records.filter((r) => r.kind === "logs").map((r) => [r.id, r.deleted]),
    );
    expect(logs["h1|2026-08-01"]).toBe(true);
    expect(logs["h1|2026-08-02"]).toBe(true);
    // Another habit's log with a similar-looking key must survive.
    expect(logs["h2|2026-08-01"]).toBe(false);
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

    const badKind = await push(access, [{ ...habit("h1", "x"), kind: "passwords" }]);
    expect(badKind.statusCode).toBe(400);

    const badId = await push(access, [{ ...habit("h1", "x"), id: "a/../../etc/passwd" }]);
    expect(badId.statusCode).toBe(400);

    const huge = await push(access, [
      {
        kind: "journal",
        id: "2026-08-01",
        data: { text: "ب".repeat(20_000) },
        updatedAt: 1,
        deleted: false,
      },
    ]);
    expect(huge.statusCode).toBe(400);
  });

  it("survives a habit tombstone that repeats a log the client also sent", async () => {
    const { access } = await signIn("09120000012");

    // A log exists on the server, so the habit delete will try to cascade it.
    await push(access, [
      { kind: "logs", id: "h1|2026-08-01", data: { done: 1 }, updatedAt: 1000, deleted: false },
    ]);

    // The client deletes the habit AND happens to send that same log itself.
    // Both name (logs, h1|2026-08-01), and an INSERT … ON CONFLICT DO UPDATE
    // that touches one key twice is a hard Postgres error — which would 500 a
    // push the client then retries forever, wedging sync for this account.
    const res = await push(access, [
      { kind: "habits", id: "h1", data: null, updatedAt: 2000, deleted: true },
      { kind: "logs", id: "h1|2026-08-01", data: null, updatedAt: 2000, deleted: true },
    ]);
    expect(res.statusCode).toBe(200);

    const down = (await pull(access, 0)).json() as { records: { id: string; deleted: boolean }[] };
    expect(down.records.find((r) => r.id === "h1|2026-08-01")!.deleted).toBe(true);
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
