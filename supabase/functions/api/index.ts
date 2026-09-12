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
import { loadEdgeEnv, testProviderWarnings } from "./shared/env.ts";
import { fakePsp, zarinpalPsp } from "./shared/providers/psp/index.ts";
import { consoleSms, kavenegarSms, type SmsProvider } from "./shared/providers/sms/index.ts";
import { ensureOwner } from "./shared/services/owner-bootstrap.ts";

const env = loadEdgeEnv(Deno.env.toObject());

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
});
const db = drizzle(client, { schema }) as unknown as Database;

// Routino's ZarinPal relay runs as a Cloudflare Pages Function. The plaintext
// shared secret exists only in Supabase Vault; GitHub stores only its SHA-256 in
// the Pages Function. If Vault is temporarily unavailable, the provider falls
// back to the configured/default direct ZarinPal endpoint rather than preventing
// the API from booting.
let pagesRelaySecret = "";
try {
  const rows = await client<{ decrypted_secret: string }[]>`
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'routino_zarinpal_pages_relay_secret'
    limit 1
  `;
  pagesRelaySecret = typeof rows[0]?.decrypted_secret === "string" ? rows[0].decrypted_secret : "";
} catch (err) {
  console.error("could not read ZarinPal relay secret from Vault", err);
}

const zarinpalApiBase = pagesRelaySecret
  ? "https://routino.me/zarinpal-relay"
  : env.ZARINPAL_API_BASE;
const zarinpalProxySecret = pagesRelaySecret || env.ZARINPAL_PROXY_SECRET;

const sms: SmsProvider =
  env.SMS_PROVIDER === "kavenegar"
    ? kavenegarSms(env.KAVENEGAR_API_KEY!, env.KAVENEGAR_TEMPLATE)
    : consoleSms();

const psp =
  env.PSP_PROVIDER === "zarinpal"
    ? zarinpalPsp(env.ZARINPAL_MERCHANT, {
        apiBase: zarinpalApiBase,
        proxySecret: zarinpalProxySecret,
      })
    : fakePsp(env.PUBLIC_API_URL);

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

console.log(`[api] edge function up (sms=${env.SMS_PROVIDER}, psp=${psp.name}, zarinpalBase=${zarinpalApiBase})`);

for (const w of testProviderWarnings(env)) console.warn(`[!] TEST MODE — ${w}`);

Deno.serve(app.fetch);
