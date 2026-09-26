import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { adminDeleteUser } from "../src/services/admin-user-delete.js";
import { makeHarness, type Harness } from "./helpers/pglite.js";

const migrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260911120000_lifetime_user_analytics.sql",
    import.meta.url,
  ),
);

describe("lifetime analytics and explicit admin deletion", () => {
  let h: Harness | undefined;

  afterAll(async () => {
    await h?.close();
  });

  it("removes retained lifetime identity only for explicit permanent deletion", async () => {
    h = await makeHarness();
    await h.script(readFileSync(migrationPath, "utf8"));

    const id = "21000000-0000-4000-8000-000000000001";
    const phone = "989120002101";
    await h.raw(`
      insert into users (id, phone, username, created_at)
      values (
        '${id}',
        '${phone}',
        'deleteanalytics',
        '2026-09-11T08:00:00+03:30'
      );
    `);

    expect(
      await h.query(`select phone from lifetime_users where phone = '${phone}'`),
    ).toHaveLength(1);

    const result = await adminDeleteUser(h.db, h.env, id, "deleteanalytics");
    expect(result).toMatchObject({ ok: true, deletedUserId: id });
    expect(await h.query(`select id from users where id = '${id}'`)).toHaveLength(0);
    expect(
      await h.query(`select phone from lifetime_users where phone = '${phone}'`),
    ).toHaveLength(0);
  });
});
