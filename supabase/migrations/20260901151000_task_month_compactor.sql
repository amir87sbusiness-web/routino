begin;

-- JavaScript/Zod count string bounds in UTF-16 code units. PostgreSQL counts
-- Unicode scalar values, so each non-BMP character needs one extra unit here.
create or replace function routino_js_string_length(p_text text)
returns integer
language sql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $function$
  select (
    char_length(p_text) + count(*) filter (
      where octet_length(substr(p_text, position, 1)) = 4
    )
  )::integer
    from generate_series(1, char_length(p_text)) position
$function$;

-- Fail-closed copy of the canonical TypeScript task validator. Only payloads
-- which can be reconstructed as ordinary v2 task envelopes may be archived.
create or replace function routino_task_archive_candidate_valid(
  p_id text,
  p_data jsonb
)
returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $function$
declare
  v_year integer;
  v_month integer;
  v_day integer;
  v_max_day integer;
begin
  -- Bound attacker/legacy work before any per-character UTF-16 scan. This is a
  -- separate statement because SQL does not guarantee boolean evaluation order.
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 20480 then
    return false;
  end if;

  if p_id !~ '^[A-Za-z0-9_:.-]{1,128}$'
     or not (p_data ?& array['id','dateKey','title','type','target','value','done'])
     or p_data - array[
       'id','dateKey','title','type','target','value','done',
       'note','unitKind','reminderAt','color','icon'
     ] <> '{}'::jsonb
     or jsonb_typeof(p_data->'id') <> 'string'
     or p_data->>'id' <> p_id
     or jsonb_typeof(p_data->'dateKey') <> 'string'
     or p_data->>'dateKey' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or jsonb_typeof(p_data->'title') <> 'string'
     or routino_js_string_length(p_data->>'title') not between 1 and 256
     or jsonb_typeof(p_data->'type') <> 'string'
     or p_data->>'type' not in ('binary', 'quantity')
     or jsonb_typeof(p_data->'target') <> 'number'
     or (p_data->>'target')::numeric not between 0 and 1000000000
     or jsonb_typeof(p_data->'value') <> 'number'
     or (p_data->>'value')::numeric not between 0 and 1000000000
     or jsonb_typeof(p_data->'done') <> 'boolean'
     or (
       p_data ? 'note' and (
         jsonb_typeof(p_data->'note') <> 'string'
         or routino_js_string_length(p_data->>'note') > 4000
       )
     )
     or (
       p_data ? 'unitKind' and (
         jsonb_typeof(p_data->'unitKind') <> 'string'
         or p_data->>'unitKind' not in ('count', 'time')
       )
     )
     or (
       p_data ? 'reminderAt'
       and jsonb_typeof(p_data->'reminderAt') <> 'null'
       and (
         jsonb_typeof(p_data->'reminderAt') <> 'string'
         or routino_js_string_length(p_data->>'reminderAt') > 64
       )
     )
     or (
       p_data ? 'color' and (
         jsonb_typeof(p_data->'color') <> 'string'
         or routino_js_string_length(p_data->>'color') > 32
       )
     )
     or (
       p_data ? 'icon' and (
         jsonb_typeof(p_data->'icon') <> 'string'
         or routino_js_string_length(p_data->>'icon') > 64
       )
     ) then
    return false;
  end if;

  v_year := substring(p_data->>'dateKey' from 1 for 4)::integer;
  v_month := substring(p_data->>'dateKey' from 6 for 2)::integer;
  v_day := substring(p_data->>'dateKey' from 9 for 2)::integer;
  if v_month not between 1 and 12 then return false; end if;
  v_max_day := case v_month
    when 2 then case
      when v_year % 4 = 0 and (v_year % 100 <> 0 or v_year % 400 = 0) then 29
      else 28
    end
    when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30
    else 31
  end;
  return v_day between 1 and v_max_day;
exception when others then
  return false;
end
$function$;

-- Re-encode a small deterministic set of cold completed tasks. Row locks are
-- skipped instead of waited on, and every source/delete is verified in the
-- same transaction as its immutable archive insert.
create or replace function routino_compact_task_months(
  p_now timestamptz,
  p_max_tasks integer
)
returns table (
  owner_id uuid,
  month_key text,
  archived_tasks integer,
  archive_rows integer
)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_max_tasks, 1), 500));
  v_group record;
  v_task record;
  v_chunk integer;
  v_chunk_count integer;
  v_chunk_bytes bigint;
  v_archive_rows integer;
  v_archived_tasks integer;
  v_end_seq bigint;
  v_deleted integer;
begin
  create temp table if not exists routino_compaction_selected (
    user_id uuid not null,
    task_id text not null,
    task_data jsonb not null,
    updated_at bigint not null,
    month_key text not null,
    envelope_bytes integer not null,
    primary key (user_id, task_id)
  ) on commit drop;
  create temp table if not exists routino_compaction_items (
    user_id uuid not null,
    month_key text not null,
    chunk_no integer not null,
    task_id text not null,
    task_data jsonb not null,
    updated_at bigint not null,
    envelope_bytes integer not null,
    primary key (user_id, month_key, chunk_no, task_id)
  ) on commit drop;
  truncate pg_temp.routino_compaction_selected;
  truncate pg_temp.routino_compaction_items;

  with locked as (
    select source.user_id,
           source.id as task_id,
           source.data as task_data,
           source.updated_at,
           left(source.data->>'dateKey', 7) as month_key,
           octet_length(jsonb_build_object(
             'kind', 'tasks',
             'id', source.id,
             'data', source.data,
             'updatedAt', source.updated_at,
             'deleted', false
           )::text)::integer as envelope_bytes
      from records source
     where source.kind = 'tasks'
       and source.deleted = false
       and source.data->>'done' = 'true'
       and routino_task_archive_candidate_valid(source.id, source.data)
       and source.updated_at between 0 and 9007199254740991
       and left(source.data->>'dateKey', 7) < to_char(
         (p_now - interval '7 days') at time zone 'UTC', 'YYYY-MM'
       )
       and source.updated_at <= floor(
         extract(epoch from (p_now - interval '7 days')) * 1000
       )::bigint
       and not exists (
         select 1
           from records archive
           cross join lateral jsonb_array_elements(
             case when jsonb_typeof(archive.data->'items') = 'array'
               then archive.data->'items' else '[]'::jsonb end
           ) item
          where archive.user_id = source.user_id
            and archive.kind = 'taskMonths'
            and item->>0 = source.id
       )
     order by source.user_id, left(source.data->>'dateKey', 7), source.id
     limit v_limit
     for update of source skip locked
  )
  insert into pg_temp.routino_compaction_selected (
    user_id, task_id, task_data, updated_at, month_key, envelope_bytes
  )
  select locked.user_id, locked.task_id, locked.task_data, locked.updated_at,
         locked.month_key, locked.envelope_bytes
    from locked;

  for v_group in
    select selected.user_id, selected.month_key
      from pg_temp.routino_compaction_selected selected
     group by selected.user_id, selected.month_key
     order by selected.user_id, selected.month_key
  loop
    -- Never wait behind foreground sync while holding task-row locks. A busy
    -- owner is skipped and becomes eligible again on the next bounded run.
    perform 1 from users u where u.id = v_group.user_id for update skip locked;
    if not found then continue; end if;

    v_chunk := 1;
    v_chunk_count := 0;
    v_chunk_bytes := 0;
    for v_task in
      select selected.*
        from pg_temp.routino_compaction_selected selected
       where selected.user_id = v_group.user_id
         and selected.month_key = v_group.month_key
       order by selected.task_id
    loop
      if v_chunk_count > 0 and (
        v_chunk_count >= 32 or v_chunk_bytes + v_task.envelope_bytes > 98304
      ) then
        v_chunk := v_chunk + 1;
        v_chunk_count := 0;
        v_chunk_bytes := 0;
      end if;
      insert into pg_temp.routino_compaction_items (
        user_id, month_key, chunk_no, task_id, task_data, updated_at, envelope_bytes
      ) values (
        v_task.user_id, v_task.month_key, v_chunk, v_task.task_id,
        v_task.task_data, v_task.updated_at, v_task.envelope_bytes
      );
      v_chunk_count := v_chunk_count + 1;
      v_chunk_bytes := v_chunk_bytes + v_task.envelope_bytes;
    end loop;

    select count(*)::integer into v_archive_rows
      from (
        select items.chunk_no
          from pg_temp.routino_compaction_items items
         where items.user_id = v_group.user_id
           and items.month_key = v_group.month_key
         group by items.chunk_no
      ) chunks;
    select count(*)::integer into v_archived_tasks
      from pg_temp.routino_compaction_selected selected
     where selected.user_id = v_group.user_id
       and selected.month_key = v_group.month_key;

    -- Reserve row-cap headroom for the archive inserts. This temporary counter
    -- reservation is invisible before commit and is restored after source
    -- deletion; the existing triggers still account for both physical writes.
    update users u
       set seq = u.seq + v_archive_rows,
           sync_record_count = u.sync_record_count - v_archive_rows
     where u.id = v_group.user_id
    returning u.seq into v_end_seq;

    insert into records (user_id, kind, id, data, updated_at, deleted, seq)
    select v_group.user_id,
           'taskMonths',
           v_group.month_key || '|' || md5(string_agg(items.task_id, E'\n' order by items.task_id)),
           jsonb_build_object(
             'v', 1,
             'monthKey', v_group.month_key,
             'count', count(*)::integer,
             'checksum', md5(string_agg(
               items.task_id || E'\n' || items.updated_at::text || E'\n' || items.task_data::text,
               E'\n' order by items.task_id
             )),
             'items', jsonb_agg(
               jsonb_build_array(items.task_id, items.updated_at, items.task_data)
               order by items.task_id
             )
           ),
           max(items.updated_at),
           false,
           v_end_seq - v_archive_rows + items.chunk_no
      from pg_temp.routino_compaction_items items
     where items.user_id = v_group.user_id
       and items.month_key = v_group.month_key
     group by items.chunk_no
     order by items.chunk_no;

    if exists (
      select 1
        from records archive
        join (
          select items.chunk_no,
                 v_group.month_key || '|' || md5(string_agg(items.task_id, E'\n' order by items.task_id)) as archive_id,
                 count(*)::integer as item_count,
                 md5(string_agg(
                   items.task_id || E'\n' || items.updated_at::text || E'\n' || items.task_data::text,
                   E'\n' order by items.task_id
                 )) as checksum
            from pg_temp.routino_compaction_items items
           where items.user_id = v_group.user_id
             and items.month_key = v_group.month_key
           group by items.chunk_no
        ) expected on expected.archive_id = archive.id
       where archive.user_id = v_group.user_id
         and archive.kind = 'taskMonths'
         and (
           archive.deleted
           or archive.data->'v' is distinct from '1'::jsonb
           or archive.data->>'monthKey' is distinct from v_group.month_key
           or (archive.data->>'count')::integer is distinct from expected.item_count
           or jsonb_array_length(archive.data->'items') is distinct from expected.item_count
           or archive.data->>'checksum' is distinct from expected.checksum
           or (archive.data->>'count')::integer is distinct from jsonb_array_length(archive.data->'items')
           or archive.data->>'checksum' is distinct from (
             select md5(string_agg(
               item->>0 || E'\n' || (item->>1)::bigint::text || E'\n' || (item->2)::text,
               E'\n' order by item->>0
             ))
               from jsonb_array_elements(archive.data->'items') item
           )
         )
    ) then
      raise exception 'task archive verification failed: metadata mismatch';
    end if;

    if exists (
      (
        select selected.task_id, selected.updated_at, selected.task_data
          from pg_temp.routino_compaction_selected selected
         where selected.user_id = v_group.user_id
           and selected.month_key = v_group.month_key
        except
        select item->>0, (item->>1)::bigint, item->2
          from records archive
          join (
            select v_group.month_key || '|' || md5(string_agg(items.task_id, E'\n' order by items.task_id)) as archive_id
              from pg_temp.routino_compaction_items items
             where items.user_id = v_group.user_id
               and items.month_key = v_group.month_key
             group by items.chunk_no
          ) expected on expected.archive_id = archive.id
          cross join lateral jsonb_array_elements(archive.data->'items') item
         where archive.user_id = v_group.user_id and archive.kind = 'taskMonths'
      )
      union all
      (
        select item->>0, (item->>1)::bigint, item->2
          from records archive
          join (
            select v_group.month_key || '|' || md5(string_agg(items.task_id, E'\n' order by items.task_id)) as archive_id
              from pg_temp.routino_compaction_items items
             where items.user_id = v_group.user_id
               and items.month_key = v_group.month_key
             group by items.chunk_no
          ) expected on expected.archive_id = archive.id
          cross join lateral jsonb_array_elements(archive.data->'items') item
         where archive.user_id = v_group.user_id and archive.kind = 'taskMonths'
        except
        select selected.task_id, selected.updated_at, selected.task_data
          from pg_temp.routino_compaction_selected selected
         where selected.user_id = v_group.user_id
           and selected.month_key = v_group.month_key
      )
    ) then
      raise exception 'task archive verification failed: source mismatch';
    end if;

    delete from records source
     using pg_temp.routino_compaction_selected selected
     where selected.user_id = v_group.user_id
       and selected.month_key = v_group.month_key
       and source.user_id = selected.user_id
       and source.kind = 'tasks'
       and source.id = selected.task_id
       and source.updated_at = selected.updated_at
       and source.data = selected.task_data
       and source.deleted = false;
    get diagnostics v_deleted = row_count;
    if v_deleted <> v_archived_tasks then
      raise exception 'task archive verification failed: delete mismatch';
    end if;

    update users u
       set sync_record_count = u.sync_record_count + v_archive_rows
     where u.id = v_group.user_id;

    owner_id := v_group.user_id;
    month_key := v_group.month_key;
    archived_tasks := v_archived_tasks;
    archive_rows := v_archive_rows;
    return next;
  end loop;
end
$function$;

revoke execute on function routino_js_string_length(text) from public;
revoke execute on function routino_task_archive_candidate_valid(text, jsonb) from public;
revoke execute on function routino_compact_task_months(timestamptz, integer) from public;

commit;
