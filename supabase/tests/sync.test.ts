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
import { auth, makeHarness, signIn, type Harness } from "./helpers/harness.ts";

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
  data: { id, name },
  updatedAt,
  deleted: false,
});

describe("edge sync", () => {
  it("exchanges local and remote changes in one authenticated invocation", async () => {
    const { access } = await signIn(h, "09120001123");
    const response = await h.call("POST", "/v1/sync/exchange", {
      headers: auth(access),
      body: { cursor: 0, records: [habit("h1", "ورزش")], includeAccountState: false },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      applied: 1,
      skipped: 0,
      records: [expect.objectContaining({ id: "h1" })],
    });
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
