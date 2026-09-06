import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";
import { pullRecords } from "../src/services/sync.js";

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  // The production migration is deliberately not applied by the old fixture.
  // Supplying only the wished-for columns keeps this a route-behaviour test:
  // it fails until the existing sync exchange actually records activity.
  await h.raw(`
    alter table users add column if not exists active_days integer not null default 0;
    alter table users add column if not exists last_active_at timestamptz;
  `);
});

afterAll(async () => {
  await h?.close();
});

async function signIn() {
  const phone = "09123334444";
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const response = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { access: string; user: { id: string } };
}

async function exchange(access: string) {
  return h.app.inject({
    method: "POST",
    url: "/v1/sync/exchange",
    headers: { authorization: `Bearer ${access}` },
    payload: { protocolVersion: 2, cursor: 0, records: [], includeAccountState: false },
  });
}

async function activity(userId: string) {
  const [row] = await h.query<{ active_days: number; last_active_at: Date | null }>(`
    select active_days, last_active_at from users where id = '${userId}'
  `);
  return row!;
}

describe("user activity on sync", () => {
  it("counts the Tehran midnight boundary once, including an older delayed request", async () => {
    await h.truncate();
    const { user } = await signIn();
    const pullAt = (instant: string) =>
      pullRecords(
        h.db,
        user.id,
        0,
        10,
        undefined,
        undefined,
        undefined,
        undefined,
        new Date(instant),
      );
    await pullAt("2026-09-06T20:29:59.000Z");
    expect((await activity(user.id)).active_days).toBe(1);
    await pullAt("2026-09-06T20:30:00.000Z");
    const nextDay = await activity(user.id);
    expect(nextDay.active_days).toBe(2);
    await pullAt("2026-09-06T20:29:59.000Z");
    await pullAt("2026-09-06T20:30:01.000Z");
    expect(await activity(user.id)).toEqual(nextDay);
  });

  it("records activity inside the single empty-exchange database statement", async () => {
    await h.truncate();
    const { access, user } = await signIn();
    const execute = vi.spyOn(h.db, "execute");
    try {
      expect((await exchange(access)).statusCode).toBe(200);
      expect(execute).toHaveBeenCalledTimes(1);
      expect((await activity(user.id)).active_days).toBe(1);
      const first = await activity(user.id);
      await Promise.all(Array.from({ length: 8 }, () => exchange(access)));
      expect(await activity(user.id)).toEqual(first);
    } finally {
      execute.mockRestore();
    }
  });

  it("counts a Tehran calendar day once and refreshes the last activity", async () => {
    await h.truncate();
    const { access, user } = await signIn();

    expect((await exchange(access)).statusCode).toBe(200);
    const first = await activity(user.id);
    expect(first.active_days).toBe(1);
    expect(first.last_active_at).not.toBeNull();

    expect((await exchange(access)).statusCode).toBe(200);
    expect((await activity(user.id)).active_days).toBe(1);

    await h.raw(`
      update users
         set last_active_at = now() - interval '2 days'
       where id = '${user.id}'
    `);
    expect((await exchange(access)).statusCode).toBe(200);
    expect((await activity(user.id)).active_days).toBe(2);
  });
});
