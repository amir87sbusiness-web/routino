/**
 * Test harness: a real Postgres (PGlite = Postgres compiled to WASM) per test
 * file, driven through the real Fastify app via `app.inject()`. No Docker, no
 * ports, milliseconds per test.
 *
 * What this CANNOT prove: PGlite is single-connection, so it cannot exercise
 * contention on `UPDATE users SET seq = seq + $n` or `SELECT ... FOR UPDATE` —
 * precisely the mechanisms those choices exist for. It proves LOGIC, never
 * CONCURRENCY. That is why the concurrency-critical paths are single statements
 * whose correctness is a Postgres guarantee rather than our code's; the real
 * assertions for those belong in a docker-compose suite run against the VM.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { buildApp, type App } from "../../src/app.js";
import { SCHEMA_SQL } from "../../src/db/ddl.js";
import { schema } from "../../src/db/schema.js";
import { loadEnv, type Env } from "../../src/env.js";
import { fakePsp } from "../../src/providers/psp/fake.js";
import { createRouter } from "../../src/providers/psp/router.js";
import type { SmsProvider } from "../../src/providers/sms/index.js";

/** Captures OTP codes so tests can assert on them without a network. */
export interface TestSms extends SmsProvider {
  sent: { phone: string; code: string }[];
  last(): { phone: string; code: string } | undefined;
}

export function testSms(): TestSms {
  const sent: { phone: string; code: string }[] = [];
  return {
    sent,
    last: () => sent.at(-1),
    async sendOtp(phone, code) {
      sent.push({ phone, code });
    },
  };
}

export interface Harness {
  app: App;
  db: PgliteDatabase<typeof schema>;
  sms: TestSms;
  psp: ReturnType<typeof fakePsp>;
  env: Env;
  /** Raw SQL for test setup. Uses PGlite's `.exec()`, which — unlike Drizzle's
   * prepared `.execute()` — accepts multi-statement scripts. */
  raw(query: string): Promise<void>;
  /** Raw SQL returning rows. Drizzle's `.execute()` yields `{ rows }` on PGlite
   * and a bare array on node-postgres, so tests use this instead of guessing. */
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

/** Applies the shared DDL through PGlite's raw `.exec()`: Drizzle's `.execute()`
 * sends a prepared statement, which cannot carry more than one command, and this
 * is a multi-statement script. The SQL itself lives in `src/db/ddl.ts` so the
 * dev bootstrap and the tests can never drift apart. */
async function createSchema(pglite: PGlite): Promise<void> {
  await pglite.exec(SCHEMA_SQL);
}

/** Mirrors `src/lib/presets.ts` PLANS so client and server agree in tests. */
async function seedPlans(db: PgliteDatabase<typeof schema>): Promise<void> {
  await db.insert(schema.plans).values([
    { id: "m1", nameFa: "یک‌ماهه", nameEn: "1 Month", months: 1, priceToman: 59000 },
    { id: "m3", nameFa: "سه‌ماهه", nameEn: "3 Months", months: 3, priceToman: 149000 },
    { id: "m12", nameFa: "یک‌ساله", nameEn: "1 Year", months: 12, priceToman: 449000 },
  ]);
}

export async function makeHarness(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<Harness> {
  const env = loadEnv({ ...process.env, NODE_ENV: "test", ...overrides });
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });

  await createSchema(pglite);
  await seedPlans(db);

  const sms = testSms();
  // Tests drive the fake gateway directly (h.psp._txns/_settle), so expose the
  // provider itself while the app talks to it through the real router.
  const psp = fakePsp(env.PUBLIC_API_URL);
  const app = await buildApp({ db, env, sms, psp: createRouter([psp]) });

  return {
    app,
    db,
    sms,
    psp,
    env,
    async raw(query: string) {
      await pglite.exec(query);
    },
    async query<T = Record<string, unknown>>(sql: string) {
      const res = await pglite.query<T>(sql);
      return res.rows;
    },
    async truncate() {
      // Fresh PGlite per file is ~150ms; truncating between tests is ~1ms.
      await db.execute(sql`
        truncate users, records, devices, device_security_events, otp_codes, login_attempts, discounts,
                 redemptions, payments, grants, entitlements, feedback, admins
        restart identity cascade
      `);
      await db.delete(schema.plans);
      await seedPlans(db);
      sms.sent.length = 0;
    },
    async close() {
      await app.close();
      await pglite.close();
    },
  };
}
