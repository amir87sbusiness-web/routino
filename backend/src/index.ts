/**
 * Production entry point.
 *
 * The ONLY module that constructs a real database connection. Everything else
 * receives a `Database` — that inversion is what lets the tests inject PGlite
 * and run the real app with no Docker and no ports.
 */
import { buildApp } from "./app.js";
import type { Database } from "./db/client.js";
import { SCHEMA_SQL, SEED_DISCOUNTS_SQL, SEED_PLANS_SQL } from "./db/ddl.js";
import { schema } from "./db/schema.js";
import { loadEnv, pspProviderNames } from "./env.js";
import { consoleSms, kavenegarSms, type SmsProvider } from "./providers/sms/index.js";
import {
  createRouter,
  fakePsp,
  zarinpalPsp,
  zibalPsp,
  type PspProvider,
} from "./providers/psp/index.js";

const env = loadEnv();

let db: Database;
let shutdownDb: () => Promise<void>;

if (env.DB_DRIVER === "pglite") {
  // Real Postgres, in-process, persisted to disk. Lets `npm run dev` work with
  // nothing installed — same engine as production, not a stand-in. Single
  // connection, so `env.ts` forbids this in production.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(env.PGLITE_DIR);
  await client.exec(SCHEMA_SQL);
  await client.exec(SEED_PLANS_SQL);
  await client.exec(SEED_DISCOUNTS_SQL);
  db = drizzle(client, { schema });
  shutdownDb = () => client.close();
  console.log(`  [db] pglite at ${env.PGLITE_DIR}`);
} else {
  const { default: pg } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  // Same idempotent bootstrap as dev. Without this, the first production boot
  // has zero tables and zero plans — checkout would 404 on day one. The dev
  // discount seed (ROUTINO20) deliberately never ships to production.
  await pool.query(SCHEMA_SQL);
  await pool.query(SEED_PLANS_SQL);
  if (env.NODE_ENV !== "production") await pool.query(SEED_DISCOUNTS_SQL);
  db = drizzle(pool, { schema });
  shutdownDb = () => pool.end();
}

const sms: SmsProvider =
  env.SMS_PROVIDER === "kavenegar"
    ? kavenegarSms(env.KAVENEGAR_API_KEY!, env.KAVENEGAR_TEMPLATE)
    : consoleSms();

// One or more gateways, behind a router that picks the fastest healthy one per
// checkout and fails over. A single configured gateway is a thin pass-through.
const makePsp = (name: ReturnType<typeof pspProviderNames>[number]): PspProvider => {
  switch (name) {
    case "zibal":
      return zibalPsp(env.ZIBAL_MERCHANT);
    case "zarinpal":
      return zarinpalPsp(env.ZARINPAL_MERCHANT);
    case "fake":
      return fakePsp(env.PUBLIC_API_URL);
  }
};
const pspNames = pspProviderNames(env);
const psp = createRouter(pspNames.map(makePsp));

const app = await buildApp({ db, env, sms, psp });

// Ensure the owner account (if configured) can sign in with a password from the
// first boot. Idempotent, and it never clobbers an already-set password.
const { ensureOwner } = await import("./services/owner-bootstrap.js");
await ensureOwner(db, env, new Date(), {
  info: (msg) => app.log.info(msg),
  warn: (msg) => app.log.warn(msg),
}).catch((err) => app.log.error({ err }, "owner bootstrap failed"));

// OTP rows double as the rate-limit ledger, so they must live 24h — after
// that they are pure noise. Hourly is plenty. Failed-login rows are purged on
// the same beat.
const { purgeOldCodes } = await import("./services/otp.js");
const { purgeOldLoginAttempts } = await import("./services/login-throttle.js");
const purgeTimer = setInterval(() => {
  const t = new Date();
  purgeOldCodes(db, t).catch((err) => app.log.error({ err }, "otp purge failed"));
  purgeOldLoginAttempts(db, t).catch((err) => app.log.error({ err }, "login-attempt purge failed"));
}, 3_600_000);

const close = async () => {
  clearInterval(purgeTimer);
  await app.close();
  await shutdownDb();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ port: env.PORT, host: "0.0.0.0" });
console.log(
  `  [api] listening on :${env.PORT}  (sms=${env.SMS_PROVIDER}, psp=${pspNames.join("+")})`,
);
