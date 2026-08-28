/**
 * Edge-function test harness.
 *
 * Same technique as backend/test/helpers/pglite.ts: a real Postgres (PGlite)
 * per file, driven through the REAL edge app — the exact Hono app + shared
 * modules that `supabase functions deploy` ships. Only the Deno entry
 * (index.ts: Deno.serve + the postgres-js pool) is outside test reach; every
 * route, middleware and service below it is exercised here under Node.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { buildApp } from "../../functions/api/app.ts";
import type { Deps } from "../../functions/api/deps.ts";
import { SCHEMA_SQL } from "../../functions/api/shared/db/ddl.ts";
import { schema } from "../../functions/api/shared/db/schema.ts";
import { loadEnv, type Env } from "../../functions/api/shared/env.ts";
import { fakePsp } from "../../functions/api/shared/providers/psp/fake.ts";
import type { PspProvider } from "../../functions/api/shared/providers/psp/index.ts";
import type { SmsProvider } from "../../functions/api/shared/providers/sms/index.ts";
import type { Database } from "../../functions/api/shared/db/client.ts";

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

export interface CallInit {
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Harness {
  app: ReturnType<typeof buildApp>;
  db: PgliteDatabase<typeof schema>;
  sms: TestSms;
  psp: ReturnType<typeof fakePsp>;
  env: Env;
  /** Requests against the app. `path` is the public path (e.g. `/v1/plans`);
   * the `/api` function base is added here, mirroring the Supabase gateway. */
  call(method: string, path: string, init?: CallInit): Promise<Response>;
  /** Follows an absolute-URL redirect (dev gateway → callback) into the app. */
  follow(location: string): Promise<Response>;
  raw(query: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

async function seedPlans(db: PgliteDatabase<typeof schema>): Promise<void> {
  await db.insert(schema.plans).values([
    { id: "m1", nameFa: "یک‌ماهه", nameEn: "1 Month", months: 1, priceToman: 59000 },
    { id: "m3", nameFa: "سه‌ماهه", nameEn: "3 Months", months: 3, priceToman: 149000 },
    { id: "m12", nameFa: "یک‌ساله", nameEn: "1 Year", months: 12, priceToman: 449000 },
  ]);
}

export async function makeHarness(
  overrides: Record<string, string> = {},
  paymentProvider?: PspProvider,
): Promise<Harness> {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "test",
    PROXY_SECRET: "",
    // Production-like origin list, so the CORS behaviour asserted here is the
    // one routino.me actually gets.
    CORS_ORIGINS: "https://routino.me,https://localhost,capacitor://localhost",
    ...overrides,
  } as NodeJS.ProcessEnv);
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });

  await pglite.exec(SCHEMA_SQL);
  await seedPlans(db);

  const sms = testSms();
  const psp = fakePsp(env.PUBLIC_API_URL);
  const deps: Deps = {
    db: db as unknown as Database,
    env,
    sms,
    psp: paymentProvider ?? psp,
    now: () => Date.now(),
  };
  const app = buildApp(deps);

  const call = (method: string, path: string, init: CallInit = {}) =>
    app.request(`/api${path}`, {
      method,
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  return {
    app,
    db,
    sms,
    psp,
    env,
    call,
    follow(location: string) {
      const path = location.replace(env.PUBLIC_API_URL, "");
      return app.request(`/api${path}`);
    },
    async raw(query: string) {
      await pglite.exec(query);
    },
    async query<T = Record<string, unknown>>(q: string) {
      const res = await pglite.query<T>(q);
      return res.rows;
    },
    async truncate() {
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
      await pglite.close();
    },
  };
}

/** Signs a user in through the real OTP flow; returns tokens + entitlement. */
export async function signIn(
  h: Harness,
  phone = "09123334444",
  installationKey = `edge-test-${phone}`,
) {
  await h.call("POST", "/v1/auth/otp/request", { body: { phone } });
  const code = h.sms.last()!.code;
  const res = await h.call("POST", "/v1/auth/otp/verify", {
    body: {
      phone,
      code,
      device: {
        installationKey,
        name: "Edge test browser",
        platform: "web",
      },
    },
  });
  if (res.status !== 200) throw new Error(`signIn failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as {
    access: string;
    refresh: string;
    deviceId: string;
    user: { id: string; phone: string };
    entitlement: { status: string; expiresAt: string };
    isNew: boolean;
  };
}

export const auth = (access: string) => ({ authorization: `Bearer ${access}` });
