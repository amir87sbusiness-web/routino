/** Read synthetic local records; compare native PostgreSQL storage in TEMP tables. */
import postgres from "postgres";
import { writeFileSync } from "node:fs";
const input = process.argv[process.argv.indexOf("--url") + 1];
if (!process.argv.includes("--url"))
  throw new Error("--url must name a synthetic loopback database");
const parsed = new URL(input);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
  throw new Error("Local database only");
const db = postgres(input, { prepare: false, max: 1, onnotice: () => {} });
const results = [];
try {
  for (const target of [2040, 1024, 512]) {
    const name = `storage_bench_${target}`;
    await db.unsafe(
      `create temporary table ${name} (like records including all) with (toast_tuple_target=${target})`,
    );
    const start = performance.now();
    // text round-trip prevents copying already-compressed datums unchanged.
    await db.unsafe(
      `insert into ${name} select user_id,kind,id,data::text::jsonb,updated_at,deleted,seq from records order by user_id,seq`,
    );
    const insertMs = performance.now() - start;
    await db.unsafe(`vacuum analyze ${name}`);
    const [sizes] =
      await db`select pg_table_size(${name}::regclass)::bigint as heap_and_toast_bytes,
      pg_indexes_size(${name}::regclass)::bigint as index_bytes,
      pg_total_relation_size(${name}::regclass)::bigint as total_bytes`;
    const startRead = performance.now();
    const [equality] = await db.unsafe(`select count(*)::int as rows,
      count(*) filter (where a.data is distinct from b.data or a.updated_at<>b.updated_at or a.seq<>b.seq or a.deleted<>b.deleted)::int as mismatches,
      sum(octet_length(a.data::text))::bigint as logical_json_bytes
      from ${name} a join records b using(user_id,kind,id)`);
    results.push({
      target,
      ...sizes,
      ...equality,
      insertMs,
      fullCompareMs: performance.now() - startRead,
    });
  }
  console.log(JSON.stringify(results, null, 2));
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0)
    writeFileSync(process.argv[outputIndex + 1], JSON.stringify(results, null, 2));
} finally {
  await db.end();
}
