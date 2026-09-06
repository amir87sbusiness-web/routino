import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { SCHEMA_SQL } from "../src/db/ddl.js";
import { schema } from "../src/db/schema.js";
import { pullRecords } from "../src/services/sync.js";

const connectionString = process.env.ROUTINO_TEST_POSTGRES_URL;
const realPostgresTest = connectionString ? it : it.skip;

realPostgresTest(
  "concurrent pull CTEs count one activity per Tehran day on real PostgreSQL",
  async () => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString!).hostname)) {
      throw new Error("Synthetic loopback PostgreSQL only");
    }
    const pool = new Pool({ connectionString, max: 12 });
    const userId = crypto.randomUUID();
    try {
      await pool.query(SCHEMA_SQL);
      await pool.query("insert into users(id,phone) values($1,$2)", [userId, `activity-${userId}`]);
      const db = drizzle(pool, { schema });
      const pullAt = (instant: string) =>
        pullRecords(
          db,
          userId,
          0,
          10,
          undefined,
          undefined,
          undefined,
          undefined,
          new Date(instant),
        );
      for (const [instant, expectedDays] of [
        ["2026-09-06T20:29:59Z", 1],
        ["2026-09-06T20:30:00Z", 2],
      ] as const) {
        await Promise.all(Array.from({ length: 50 }, () => pullAt(instant)));
        const { rows } = await pool.query(
          "select active_days,last_active_at from users where id=$1",
          [userId],
        );
        expect(rows[0].active_days).toBe(expectedDays);
        expect(rows[0].last_active_at.toISOString()).toBe(new Date(instant).toISOString());
      }
      await pullAt("2026-09-06T20:29:59Z");
      expect(
        (await pool.query("select active_days from users where id=$1", [userId])).rows[0]
          .active_days,
      ).toBe(2);
    } finally {
      await pool.query("delete from users where id=$1", [userId]);
      await pool.end();
    }
  },
  20_000,
);
