import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminSignIn, makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
let admin: Record<string, string>;

beforeEach(async () => {
  h ??= await makeHarness();
  await h.truncate();
  admin = await adminSignIn(h);
});

afterAll(async () => {
  await h?.close();
});

async function signIn(phone: string) {
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const response = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  return response.json() as { access: string; user: { id: string } };
}

type UserPage = {
  users: { id: string; activeDays: number; createdAt: string }[];
  pagination: { pageSize: number; hasNext: boolean; nextCursor: string | null };
  sort: { key: string; direction: string };
};

describe("admin user browser", () => {
  it("walks the complete user set 100 at a time with a cursor", async () => {
    await h.raw(`
      insert into users (
        phone, username, created_at, active_days, last_active_at,
        sync_record_count, sync_data_bytes
      )
      select
        '98913' || lpad(g::text, 7, '0'),
        'person_' || lpad(g::text, 3, '0'),
        '2026-01-01T00:00:00Z'::timestamptz + g * interval '1 day',
        g,
        '2026-01-01T12:00:00Z'::timestamptz + g * interval '1 day',
        g * 10,
        g * 1024
      from generate_series(1, 205) as g;
    `);

    const first = await h.app.inject({
      method: "GET",
      url: "/v1/admin/users?limit=100&sort=activeDays&direction=desc",
      headers: admin,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as UserPage;
    expect(firstBody.pagination.pageSize).toBe(100);
    expect(firstBody.pagination.hasNext).toBe(true);
    expect(firstBody.pagination.nextCursor).toEqual(expect.any(String));
    expect(firstBody.users).toHaveLength(100);
    expect(firstBody.users[0]?.activeDays).toBe(205);
    expect(firstBody.users.at(-1)?.activeDays).toBe(106);
    expect(firstBody.users[0]?.createdAt).toBeTruthy();

    const second = await h.app.inject({
      method: "GET",
      url:
        "/v1/admin/users?limit=999&sort=activeDays&direction=desc&cursor=" +
        encodeURIComponent(firstBody.pagination.nextCursor!),
      headers: admin,
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as UserPage;
    expect(secondBody.pagination.pageSize).toBe(100);
    expect(secondBody.pagination.hasNext).toBe(true);
    expect(secondBody.pagination.nextCursor).toEqual(expect.any(String));
    expect(secondBody.users).toHaveLength(100);
    expect(secondBody.users[0]?.activeDays).toBe(105);
    expect(secondBody.users.at(-1)?.activeDays).toBe(6);

    const last = await h.app.inject({
      method: "GET",
      url:
        "/v1/admin/users?sort=activeDays&direction=desc&cursor=" +
        encodeURIComponent(secondBody.pagination.nextCursor!),
      headers: admin,
    });
    expect(last.statusCode).toBe(200);
    const lastBody = last.json() as UserPage;
    expect(lastBody.pagination).toMatchObject({ pageSize: 100, hasNext: false, nextCursor: null });
    expect(lastBody.users.map((user) => user.activeDays)).toEqual([5, 4, 3, 2, 1]);

    const ids = [...firstBody.users, ...secondBody.users, ...lastBody.users].map((user) => user.id);
    expect(ids).toHaveLength(205);
    expect(new Set(ids).size).toBe(205);
  });

  it("applies activity, storage, registration and name ordering in SQL", async () => {
    await h.raw(`
      insert into users (
        phone, username, created_at, active_days, last_active_at,
        sync_record_count, sync_data_bytes
      ) values
        ('989120000000', 'zeta',  '2026-09-01T00:00:00Z', 2,  '2026-09-02T00:00:00Z',  2, 1048576),
        ('989120000001', 'alpha', '2026-09-03T00:00:00Z', 8,  '2026-09-04T00:00:00Z', 20, 4194304),
        ('989120000002', 'mona',  '2026-09-05T00:00:00Z', 12, '2026-09-06T00:00:00Z', 40, 8388608);
    `);

    const filtered = await h.app.inject({
      method: "GET",
      url: "/v1/admin/users?minActiveDays=5&maxActiveDays=10&minDataBytes=2097152&maxDataBytes=6291456&registeredFrom=2026-09-02T00%3A00%3A00.000Z&registeredTo=2026-09-04T23%3A59%3A59.999Z&sort=name&direction=asc",
      headers: admin,
    });
    const body = filtered.json() as {
      users: { username: string; activeDays: number; syncDataBytes: number }[];
      pagination: { pageSize: number; hasNext: boolean; nextCursor: string | null };
      sort: { key: string; direction: string };
    };
    expect(body.users).toEqual([
      expect.objectContaining({ username: "alpha", activeDays: 8, syncDataBytes: 4_194_304 }),
    ]);
    expect(body.pagination).toMatchObject({ pageSize: 100, hasNext: false, nextCursor: null });
    expect(body.sort).toEqual({ key: "name", direction: "asc" });
  });

  it("filters active, expired and never-entitled accounts separately", async () => {
    const active = await signIn("09121110001");
    const expired = await signIn("09121110002");
    const none = await signIn("09121110003");

    for (const session of [active, expired]) {
      const response = await h.app.inject({
        method: "POST",
        url: "/v1/subscriptions/trial/start",
        headers: { authorization: `Bearer ${session.access}` },
      });
      expect(response.statusCode).toBe(200);
    }
    await h.raw(`
      update entitlements
         set expires_at = '2026-01-01T00:00:00Z'
       where user_id = '${expired.user.id}';
    `);

    const activeResult = await h.app.inject({
      method: "GET",
      url: "/v1/admin/users?subscription=active",
      headers: admin,
    });
    const expiredResult = await h.app.inject({
      method: "GET",
      url: "/v1/admin/users?subscription=expired",
      headers: admin,
    });
    const noneResult = await h.app.inject({
      method: "GET",
      url: "/v1/admin/users?subscription=none",
      headers: admin,
    });

    expect(activeResult.json().users.map((user: { id: string }) => user.id)).toEqual([
      active.user.id,
    ]);
    expect(expiredResult.json().users.map((user: { id: string }) => user.id)).toEqual([
      expired.user.id,
    ]);
    expect(noneResult.json().users.map((user: { id: string }) => user.id)).toEqual([none.user.id]);
  });
});
