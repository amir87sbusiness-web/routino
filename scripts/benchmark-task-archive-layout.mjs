/** Local synthetic layout sweep; all tables and function changes roll back. */
import postgres from "postgres";
import { readFileSync, writeFileSync } from "node:fs";
const url = process.argv[process.argv.indexOf("--url") + 1];
if (!process.argv.includes("--url") || !["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Loopback --url required");
const db = postgres(url, { max: 1, prepare: false, onnotice() {} });
const results = [];
try {
  await db.begin(async (tx) => {
    const migration = readFileSync(
      new URL("../supabase/manual-production/20260906_task_archive_v2.sql", import.meta.url),
      "utf8",
    );
    await tx.unsafe(migration.replace(/^begin;$/m, "").replace(/^commit;$/m, ""));
    await tx`set local statement_timeout='60000ms'`;
    for (const count of [8, 16, 32])
      for (const profile of ["short", "uuid", "notes"]) {
        await tx`create temporary table layout_source as
        select n, jsonb_build_object('id',case when ${profile}='short' then 'task-'||n else md5(n::text) end,
          'dateKey','2026-01-01','title','مطالعه','type','binary','target',1,'value',1,'done',true)
          || case when ${profile}='notes' then jsonb_build_object('note',repeat(md5(n::text),16)) else '{}'::jsonb end as data
        from generate_series(1,${count * 320}) n`;
        await tx`create temporary table layout_archives as select (n-1)/${count} as chunk,
        jsonb_build_object('v',1,'monthKey','2026-01','count',${count}::int,'checksum',repeat('a',32),
          'items',jsonb_agg(jsonb_build_array(data->>'id',1768000000000,data) order by n)) as data
        from layout_source group by 1`;
        for (const version of [1, 2, 3]) {
          await tx`create temporary table layout_stored (like records including all)`;
          await tx`insert into layout_stored
          with encoded as (select chunk,
            case when ${version}=1 then data else jsonb_set(jsonb_set(data,'{v}','2'),'{items}',
              (select jsonb_agg(jsonb_build_array(item->0,item->1,jsonb_build_array('01',item->2->'title',item->2->'type',item->2->'target',item->2->'value',
                 (item->2)-array['id','dateKey','title','type','target','value','done'])) order by ord)
               from jsonb_array_elements(data->'items') with ordinality x(item,ord))) end as data from layout_archives)
          select '00000000-0000-0000-0000-000000000001','taskMonths','2026-01|'||chunk,
            case when ${version}=3 then routino_task_archive_storage(data) else data end,
            1768000000000,false,chunk from encoded order by chunk`;
          const [size] = await tx`select sum(pg_column_size(data))::bigint as stored_datum_bytes,
          sum(octet_length(data::text))::bigint as json_bytes,
          pg_total_relation_size('layout_stored')::bigint as total_bytes from layout_stored`;
          const [equality] = await tx`select count(*)::int as mismatches from layout_stored a
          cross join lateral jsonb_array_elements(a.data->'items') item
          full join layout_source s on s.data->>'id'=item->>0
          where routino_expand_task_archive_item(a.data->'v',a.data->>'monthKey',item)->2 is distinct from s.data`;
          if (equality.mismatches !== 0) throw new Error("Lossy archive layout");
          results.push({ count, profile, version, ...size, ...equality });
          await tx`drop table layout_stored`;
        }
        await tx`drop table layout_archives,layout_source`;
      }
    throw new Error("ROLLBACK_OK");
  });
} catch (e) {
  if (e.message !== "ROLLBACK_OK") throw e;
} finally {
  await db.end();
}
console.log(JSON.stringify(results, null, 2));
const output = process.argv.indexOf("--output");
if (output >= 0) writeFileSync(process.argv[output + 1], JSON.stringify(results, null, 2));
