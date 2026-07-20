/**
 * Applies supabase/setup.sql to the database in DATABASE_URL.
 *
 * Usage:  DATABASE_URL="postgres://..." node scripts/apply-db-setup.mjs
 * The SQL is idempotent, so re-running is safe. Uses the backend's pg package.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(pathToFileURL(join(root, "backend", "index.js")));
const { default: pg } = await import(pathToFileURL(require.resolve("pg")).href);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first.");
  process.exit(1);
}

const sql = readFileSync(join(root, "supabase", "setup.sql"), "utf8");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 });

try {
  await client.connect();
  const { rows } = await client.query("select version()");
  console.log("[db] connected:", rows[0].version.split(",")[0]);
  await client.query(sql);
  const tables = await client.query(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  console.log("[db] tables:", tables.rows.map((r) => r.tablename).join(", "));
  const plans = await client.query("select id, price_toman from plans order by months");
  console.log("[db] plans:", plans.rows.map((r) => `${r.id}=${r.price_toman}`).join(", "));
  const jobs = await client
    .query("select jobname, schedule from cron.job")
    .catch(() => ({ rows: [] }));
  console.log(
    "[db] cron jobs:",
    jobs.rows.map((r) => `${r.jobname} (${r.schedule})`).join(", ") || "none",
  );
  console.log("[db] setup applied successfully");
} finally {
  await client.end();
}
