/** Synthetic-only, rollback-only archive benchmark in a loopback database. */
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";
const urlIndex = process.argv.indexOf("--url");
if (urlIndex < 0) throw new Error("--url is required");
const url = process.argv[urlIndex + 1];
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
  throw new Error("Loopback only");
const db = postgres(url, { max: 1, prepare: false, onnotice() {} });
const migration = readFileSync(
  new URL("../supabase/manual-production/20260906_task_archive_v2.sql", import.meta.url),
  "utf8",
);
let result;
try {
  await db.begin(async (tx) => {
    // Definitions and synthetic account roll back together. Do not commit migration here.
    await tx.unsafe(migration.replace(/^begin;$/m, "").replace(/^commit;$/m, ""));
    await tx`set local statement_timeout = '60000ms'`;
    const [owner] = await tx`insert into users(phone) values ('989990006926') returning id`;
    await tx`insert into records(user_id,kind,id,data,updated_at,deleted,seq)
      select ${owner.id}, 'tasks', 'bench-task-' || n,
        jsonb_build_object('id','bench-task-'||n,'dateKey','2026-01-'||lpad((n%28+1)::text,2,'0'),
          'title','مطالعه و تمرین روزانه '||md5(n::text),'type','quantity','target',30,'value',30,'done',true)
        || case when n%3=0 then jsonb_build_object('note','یادداشت '||md5((n+10000)::text),'reminderAt',null,'color','') else '{}'::jsonb end,
        1768000000000, false, n from generate_series(1,10000) n`;
    await tx`update users set seq=10000 where id=${owner.id}`;
    await tx`create temporary table archive_original as select id,data,updated_at from records where user_id=${owner.id}`;
    for (let i = 0; i < 20; i++)
      await tx`select * from routino_compact_task_months('2026-06-15T12:00:00Z',500)`;
    const [check] = await tx`with expanded as (
      select routino_expand_task_archive_item(a.data->'v',a.data->>'monthKey',item) as item
      from records a cross join lateral jsonb_array_elements(a.data->'items') item
      where a.user_id=${owner.id} and a.kind='taskMonths')
      select count(*)::int as task_count,
        count(*) filter(where e.item->2 is distinct from o.data or (e.item->>1)::bigint<>o.updated_at)::int as mismatches
      from expanded e full join archive_original o on o.id=e.item->>0`;
    if (check.task_count !== 10000 || check.mismatches !== 0)
      throw new Error(JSON.stringify(check));
    const sizes = [];
    for (const version of [1, 2]) {
      const name = `archive_bench_v${version}`;
      await tx.unsafe(`create temporary table ${name} (like records including all)`);
      await tx.unsafe(
        `insert into ${name}
        select user_id,kind,id,
          case when $2=2 then data else jsonb_set(jsonb_set(data,'{v}','1'),'{items}',
            (select jsonb_agg(routino_expand_task_archive_item(data->'v',data->>'monthKey',item) order by ord)
             from jsonb_array_elements(data->'items') with ordinality as x(item,ord))) end,
          updated_at,deleted,seq from records where user_id=$1 and kind='taskMonths' order by seq`,
        [owner.id, version],
      );
      const [size] =
        await tx.unsafe(`select count(*)::int as archive_rows,sum(octet_length(data::text))::bigint as logical_json_bytes,
        pg_total_relation_size('${name}'::regclass)::bigint as total_bytes_including_indexes_and_toast from ${name}`);
      sizes.push({ version, ...size });
    }
    result = { syntheticTasks: 10000, ...check, sizes };
    // Abort rather than leave fixtures, function changes, or synthetic rows behind.
    throw new Error("ROLLBACK_BENCHMARK_SUCCESS");
  });
} catch (error) {
  if (error.message !== "ROLLBACK_BENCHMARK_SUCCESS") throw error;
} finally {
  await db.end();
}
console.log(JSON.stringify(result, null, 2));
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0)
  writeFileSync(process.argv[outputIndex + 1], JSON.stringify(result, null, 2) + "\n");
