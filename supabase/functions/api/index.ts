/**
 * Supabase Edge Function entry point — the ONLY Deno-specific module.
 *
 * Everything below the HTTP layer is byte-identical to the tested Node backend
 * (see shared/ and the edge-parity test). This file only: reads env, opens the
 * pooled Postgres connection, wires providers, and serves the Hono app.
 *
 * DB connection: Supabase's transaction pooler (port 6543) with
 * `prepare: false` — the documented pattern for serverless runtimes, where many
 * short-lived isolates must share a small connection budget. `max: 2` per
 * isolate keeps the pooler from being exhausted.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { buildApp } from "./app.ts";
import type { Database } from "./shared/db/client.ts";
import { schema } from "./shared/db/schema.ts";
import { loadEnv, pspProviderNames, testProviderWarnings } from "./shared/env.ts";
import {
  createRouter,
  fakePsp,
  nextpayPsp,
  zarinpalPsp,
  zibalPsp,
  type PspProvider,
} from "./shared/providers/psp/index.ts";
import { consoleSms, kavenegarSms, type SmsProvider } from "./shared/providers/sms/index.ts";
import { ensureOwner } from "./shared/services/owner-bootstrap.ts";

const env = loadEnv(Deno.env.toObject());

const dbUrl = Deno.env.get("DATABASE_URL") ?? Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("DATABASE_URL secret is required");
if (env.NODE_ENV === "production" && dbUrl.includes("localhost")) {
  throw new Error("DATABASE_URL still points at localhost in production");
}

const client = postgres(dbUrl, {
  prepare: false, // required in transaction-pooling mode
  max: 2,
  idle_timeout: 30,
  connect_timeout: 10,
  // TLS comes from the URL's sslmode param (postgres-js honours it); the
  // documented Supabase edge pattern omits a hardcoded ssl option because the
  // function talks to the pooler inside Supabase's own network.
});
// postgres-js is not in the NodePg|PGlite type union the shared code was written
// against; the drizzle query-builder surface used is identical across drivers
// (rowsOf() already normalises the one raw-SQL result shape difference).
const db = drizzle(client, { schema }) as unknown as Database;

const sms: SmsProvider =
  env.SMS_PROVIDER === "kavenegar"
    ? kavenegarSms(env.KAVENEGAR_API_KEY!, env.KAVENEGAR_TEMPLATE)
    : consoleSms();

const makePsp = (name: ReturnType<typeof pspProviderNames>[number]): PspProvider => {
  switch (name) {
    case "zibal":
      return zibalPsp(env.ZIBAL_MERCHANT);
    case "zarinpal":
      return zarinpalPsp(env.ZARINPAL_MERCHANT);
    case "nextpay":
      return nextpayPsp(env.NEXTPAY_API_KEY ?? "");
    case "fake":
      return fakePsp(env.PUBLIC_API_URL);
  }
};
const pspNames = pspProviderNames(env);
const psp = createRouter(pspNames.map(makePsp));

const app = buildApp({ db, env, sms, psp, now: () => Date.now() });

// Ensure the owner account (if OWNER_PHONE/OWNER_PASSWORD are set) can sign in
// with a password from the first boot. Idempotent and never overwrites a
// password already chosen. Failure here must not stop the function serving.
try {
  await ensureOwner(db, env, new Date(), {
    info: (m) => console.log(m),
    warn: (m) => console.warn(m),
  });
} catch (err) {
  console.error("owner bootstrap failed", err);
}

console.log(`[api] edge function up (sms=${env.SMS_PROVIDER}, psp=${pspNames.join("+")})`);

// Loud, every cold start. "Nobody received the SMS" and "there is no money in
// the merchant account" should be answered by the log, not by a support ticket.
for (const w of testProviderWarnings(env)) console.warn(`[!] TEST MODE — ${w}`);

Deno.serve(app.fetch);
