/**
 * One account, at most MAX_ACTIVE_DEVICES signed-in devices.
 *
 * The point of these tests is not the count — it is WHICH device gets evicted
 * and whether the eviction actually reaches anyone. Both are easy to get subtly
 * wrong in a way no type checks: ordering by `created_at` evicts the owner's
 * daily phone, and forgetting that nothing on the request path reads the device
 * row makes an eviction that revokes a database column and changes nothing else.
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

const PHONE = "09123334444";

/**
 * One full OTP sign-in as the same person.
 *
 * The `otp_codes` backdating is the trick `auth.test.ts` already uses to sign in
 * repeatedly: the per-phone send limit is one code a minute, so without it the
 * second request is throttled and never issues a device.
 */
async function signIn(deviceName?: string) {
  await h.raw(`update otp_codes set consumed_at = null, created_at = now() - interval '2 minutes'`);
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone: PHONE } });
  const code = h.sms.last()!.code;
  const res = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone: PHONE, code, deviceName },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { access: string; refresh: string; deviceId: string };
}

const refresh = (token: string) =>
  h.app.inject({ method: "POST", url: "/v1/auth/token/refresh", payload: { refresh: token } });

/** Sorted, because two sign-ins in the same millisecond leave `created_at` order
 * undefined and this assertion is about membership, not ordering. */
async function liveDeviceIds(): Promise<string[]> {
  const rows = await h.query<{ id: string }>(`select id from devices where revoked_at is null`);
  return rows.map((r) => r.id).sort();
}

/** Pushes a device's last use into the distant past, making it the eviction
 * candidate without waiting. */
const makeStale = (deviceId?: string) =>
  h.raw(
    `update devices set last_seen_at = now() - interval '90 days'` +
      (deviceId ? ` where id = '${deviceId}'` : ``),
  );

describe("device limit", () => {
  it("lets a phone and a laptop both stay signed in", async () => {
    const a = await signIn("phone");
    const b = await signIn("laptop");

    expect(await liveDeviceIds()).toEqual([a.deviceId, b.deviceId].sort());
    expect((await refresh(a.refresh)).statusCode).toBe(200);
    expect((await refresh(b.refresh)).statusCode).toBe(200);
  });

  it("evicts the least recently seen device, not the oldest one", async () => {
    const a = await signIn("phone");
    const b = await signIn("laptop");
    // `a` was created first but is the device in daily use; `b` has not been
    // opened in months. Ordering by `created_at` would evict `a` — the phone
    // belonging to the person who paid — which is the whole reason this sorts
    // by `last_seen_at`.
    await makeStale(b.deviceId);

    const c = await signIn("tablet");

    expect(await liveDeviceIds()).toEqual([a.deviceId, c.deviceId].sort());
  });

  it("kills the evicted device's session", async () => {
    const a = await signIn("phone");
    await makeStale();
    await signIn("laptop");
    await signIn("tablet");

    // Nothing on the request path reads the device row, so this 401 is the only
    // thing proving an eviction reaches the user at all: `rotateRefresh` refuses
    // a revoked row, and the client clears its tokens on exactly that answer.
    expect((await refresh(a.refresh)).statusCode).toBe(401);
  });

  it("never evicts the device that just signed in", async () => {
    await signIn("one");
    await signIn("two");
    const c = await signIn("three");

    // The newcomer holds a slot even when every other device looks fresher.
    expect((await refresh(c.refresh)).statusCode).toBe(200);
  });

  it("evicts nothing while the account is under the limit", async () => {
    const a = await signIn("phone");
    expect(await liveDeviceIds()).toEqual([a.deviceId]);

    const rows = await h.query<{ n: string }>(
      `select count(*)::text as n from devices where revoked_at is not null`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
