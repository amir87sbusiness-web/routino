import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;
const CUTOFF = "2026-09-05T09:45:00.000Z";
const DAY = 86_400_000;

beforeEach(async () => {
  h ??= await makeHarness({ LEGACY_IMPORT_CUTOFF: CUTOFF });
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

async function signIn() {
  const phone = "09123335555";
  await h.app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { phone } });
  const response = await h.app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: { phone, code: h.sms.last()!.code },
  });
  return response.json() as { access: string; user: { id: string } };
}

async function importSubscription(access: string) {
  return h.app.inject({
    method: "POST",
    url: "/v1/subscriptions/import",
    headers: { authorization: `Bearer ${access}` },
    payload: { planId: "m3", expiresAt: Date.now() + 60 * DAY },
  });
}

describe("legacy subscription import cutoff", () => {
  it("keeps pre-cutoff accounts eligible", async () => {
    const { access, user } = await signIn();
    await h.raw(
      `update users set created_at = '2026-09-05T09:44:59.000Z' where id = '${user.id}'`,
    );

    const response = await importSubscription(access);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ imported: true });
  });

  it("blocks post-cutoff accounts without creating a grant", async () => {
    const { access, user } = await signIn();
    await h.raw(
      `update users set created_at = '2026-09-05T09:45:00.000Z' where id = '${user.id}'`,
    );

    const response = await importSubscription(access);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ imported: false, reason: "not_legacy_account" });
    expect(
      await h.query(`select id from grants where user_id = '${user.id}' and source = 'migration'`),
    ).toHaveLength(0);
  });
});
