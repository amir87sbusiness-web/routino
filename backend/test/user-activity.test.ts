import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

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
  it("counts a Tehran calendar day once and refreshes the last activity", async () => {
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
