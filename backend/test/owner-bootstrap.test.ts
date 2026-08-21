import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureOwner } from "../src/services/owner-bootstrap.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

let h: Harness;

beforeEach(async () => {
  h ??= await makeHarness({
    OWNER_PHONE: "09123334444",
    OWNER_PASSWORD: "OwnerPass1",
    OWNER_USERNAME: "owner",
  });
  await h.truncate();
});

afterAll(async () => {
  await h?.close();
});

describe("owner bootstrap", () => {
  it("keeps the intentional 12-month owner grant", async () => {
    const now = new Date("2026-08-21T00:00:00Z");
    await ensureOwner(h.db, h.env, now);

    const [entitlement] = await h.query<{ plan_id: string; expires_at: string }>(
      `select plan_id, expires_at from entitlements`,
    );
    expect(entitlement?.plan_id).toBe("owner");
    expect(new Date(entitlement!.expires_at).toISOString()).toBe("2027-08-21T00:00:00.000Z");

    const grants = await h.query<{ source: string; months: number; note: string }>(
      `select source, months, note from grants`,
    );
    expect(grants).toEqual([{ source: "admin", months: 12, note: "owner bootstrap" }]);
  });
});
