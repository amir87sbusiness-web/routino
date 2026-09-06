-- Manual, single-owner inverse restore for immutable taskMonths v1/v2 archives.
--
-- SAFETY:
--   1. Take and verify a scoped backup and run both precheck/postcheck first.
--   2. Replace the zero UUID below with exactly one owner UUID.
--   3. Run the complete file as one script. Any unknown, malformed, duplicate,
--      oversized, or checksum-corrupt archive aborts the transaction.
--   4. This script emits counts only. It never prints task/journal payloads,
--      phone numbers, credentials, or secrets.
--
-- PGlite proves deterministic logic and rollback only. PostgreSQL lock and
-- concurrent-writer behavior remains a native rollout gate.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $restore$
declare
  v_owner_id constant uuid := '00000000-0000-0000-0000-000000000000';
  v_owner_seq bigint;
  v_gc_seq bigint;
  v_owner_record_count integer;
  v_owner_data_bytes bigint;
  v_annual_started_at timestamptz;
  v_annual_bytes bigint;
  v_actual_record_count integer;
  v_actual_data_bytes bigint;
  v_max_record_seq bigint;
  v_archive_count integer;
  v_apply_count integer;
  v_insert_count integer;
  v_seq_base bigint;
  v_affected integer;
begin
  if v_owner_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'task archive restore refused: replace the owner UUID sentinel';
  end if;

  select owner.seq,
         owner.gc_seq,
         owner.sync_record_count,
         owner.sync_data_bytes,
         owner.sync_growth_period_started_at,
         owner.sync_growth_bytes
    into v_owner_seq,
         v_gc_seq,
         v_owner_record_count,
         v_owner_data_bytes,
         v_annual_started_at,
         v_annual_bytes
    from users owner
   where owner.id = v_owner_id
   for update;
  if not found then
    raise exception 'task archive restore refused: owner not found';
  end if;
  if v_gc_seq is null or v_gc_seq not between 0 and 9007199254740991 then
    raise exception 'task archive restore refused: GC watermark out of bounds';
  end if;
  if v_gc_seq > v_owner_seq then
    raise exception 'task archive restore refused: GC watermark exceeds owner sequence';
  end if;

  select count(record.*)::integer,
         coalesce(sum(octet_length(record.data::text)), 0)::bigint,
         coalesce(max(record.seq), 0)::bigint
    into v_actual_record_count, v_actual_data_bytes, v_max_record_seq
    from records record
   where record.user_id = v_owner_id;
  if v_owner_record_count is distinct from v_actual_record_count
     or v_owner_data_bytes is distinct from v_actual_data_bytes then
    raise exception 'task archive restore refused: lifetime counter mismatch';
  end if;
  if v_annual_started_at is null
     or v_annual_started_at > now()
     or v_annual_bytes not between 0 and 10485760 then
    raise exception 'task archive restore refused: annual fields out of bounds';
  end if;

  -- Owner lock serializes with the sync writer. Archive locks make the exact
  -- immutable source set explicit and prevent concurrent recovery/compaction.
  perform archive.id
    from records archive
   where archive.user_id = v_owner_id and archive.kind = 'taskMonths'
   order by archive.id
   for update;

  create temp table routino_restore_archives (
    archive_id text primary key,
    archive_data jsonb,
    archive_updated_at bigint not null,
    archive_deleted boolean not null,
    archive_seq bigint not null
  ) on commit drop;
  insert into pg_temp.routino_restore_archives
    (archive_id, archive_data, archive_updated_at, archive_deleted, archive_seq)
  select archive.id, archive.data, archive.updated_at, archive.deleted, archive.seq
    from records archive
   where archive.user_id = v_owner_id and archive.kind = 'taskMonths'
   order by archive.id;
  get diagnostics v_archive_count = row_count;
  if v_archive_count = 0 then
    raise exception 'task archive restore refused: owner has no archives';
  end if;

  -- A recovery-created sequence is sent to JavaScript clients as a number.
  -- Validate the complete current owner stream before any persistent mutation.
  if v_owner_seq not between 1 and 9007199254740991 then
    raise exception 'task archive restore refused: owner sequence out of bounds';
  end if;
  if exists (
    select 1 from records record
     where record.user_id = v_owner_id
       and record.seq not between 1 and 9007199254740991
  ) then
    raise exception 'task archive restore refused: record sequence out of bounds';
  end if;
  if exists (
    select 1 from records record
     where record.user_id = v_owner_id
     group by record.seq
    having count(*) > 1
  ) then
    raise exception 'task archive restore refused: duplicate record sequence';
  end if;
  if v_owner_seq < v_max_record_seq then
    raise exception 'task archive restore refused: owner sequence trails records';
  end if;

  -- Layer validation so no array function or numeric cast can run on an
  -- untrusted value before its cheap type/shape bound has succeeded.
  if exists (
    select 1 from pg_temp.routino_restore_archives archive
     where jsonb_typeof(archive.archive_data) is distinct from 'object'
        or coalesce(archive.archive_data->'v' not in ('1'::jsonb, '2'::jsonb), true)
  ) then
    raise exception 'task archive restore refused: unknown archive version';
  end if;
  if exists (
    select 1 from pg_temp.routino_restore_archives archive
     where archive.archive_deleted
        or archive.archive_data - array['v','monthKey','count','checksum','items'] <> '{}'::jsonb
        or jsonb_typeof(archive.archive_data->'monthKey') is distinct from 'string'
        or coalesce(archive.archive_data->>'monthKey', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
        or jsonb_typeof(archive.archive_data->'count') is distinct from 'number'
        or coalesce(archive.archive_data->>'count', '') !~ '^[0-9]+$'
        or case
             when coalesce(archive.archive_data->>'count', '') ~ '^[0-9]+$'
             then (archive.archive_data->>'count')::numeric not between 1 and 32
             else false
           end
        or jsonb_typeof(archive.archive_data->'checksum') is distinct from 'string'
        or coalesce(archive.archive_data->>'checksum', '') !~ '^[a-f0-9]{32}$'
        or jsonb_typeof(archive.archive_data->'items') is distinct from 'array'
  ) then
    raise exception 'task archive restore refused: malformed archive metadata';
  end if;

  create temp table routino_restore_raw_items (
    archive_id text not null,
    month_key text not null,
    item_ordinal integer not null,
    item jsonb not null,
    primary key (archive_id, item_ordinal)
  ) on commit drop;
  insert into pg_temp.routino_restore_raw_items
    (archive_id, month_key, item_ordinal, item)
  select archive.archive_id,
         archive.archive_data->>'monthKey',
         item.ordinality::integer,
         routino_expand_task_archive_item(archive.archive_data->'v', archive.archive_data->>'monthKey', item.value)
    from pg_temp.routino_restore_archives archive
    cross join lateral jsonb_array_elements(archive.archive_data->'items')
      with ordinality item(value, ordinality);

  if exists (
    select 1 from pg_temp.routino_restore_raw_items item
     where jsonb_typeof(item.item) is distinct from 'array'
  ) then
    raise exception 'task archive restore refused: malformed archive tuple type';
  end if;
  if exists (
    select 1 from pg_temp.routino_restore_raw_items item
     where jsonb_array_length(item.item) is distinct from 3
        or jsonb_typeof(item.item->0) is distinct from 'string'
        or jsonb_typeof(item.item->1) is distinct from 'number'
        or jsonb_typeof(item.item->2) is distinct from 'object'
  ) then
    raise exception 'task archive restore refused: malformed archive tuple shape';
  end if;
  if exists (
    select 1 from pg_temp.routino_restore_raw_items item
     where item.item->>1 !~ '^[0-9]+$'
  ) then
    raise exception 'task archive restore refused: malformed archive timestamp';
  end if;
  if exists (
    select 1 from pg_temp.routino_restore_raw_items item
     where (item.item->>1)::numeric not between 0 and 9007199254740991
  ) then
    raise exception 'task archive restore refused: unsafe archive timestamp';
  end if;

  create temp table routino_restore_items (
    archive_id text not null,
    month_key text not null,
    item_ordinal integer not null,
    task_id text not null,
    task_updated_at bigint not null,
    task_data jsonb not null,
    primary key (archive_id, item_ordinal)
  ) on commit drop;
  insert into pg_temp.routino_restore_items
    (archive_id, month_key, item_ordinal, task_id, task_updated_at, task_data)
  select item.archive_id,
         item.month_key,
         item.item_ordinal,
         item.item->>0,
         (item.item->>1)::bigint,
         item.item->2
    from pg_temp.routino_restore_raw_items item;

  if exists (
    select 1 from pg_temp.routino_restore_items item
     where not routino_task_archive_candidate_valid(item.task_id, item.task_data)
        or left(item.task_data->>'dateKey', 7) is distinct from item.month_key
  ) then
    raise exception 'task archive restore refused: malformed task payload';
  end if;
  if exists (
    select 1
      from pg_temp.routino_restore_items item
     group by item.task_id
    having count(*) > 1
  ) then
    raise exception 'task archive restore refused: duplicate archived task id';
  end if;
  if exists (
    select 1
      from pg_temp.routino_restore_archives archive
      join (
        select item.archive_id,
               count(*)::integer as item_count,
               md5(string_agg(item.task_id, E'\n' order by item.task_id collate "C")) as id_checksum,
               md5(string_agg(
                 item.task_id || E'\n' || item.task_updated_at::text || E'\n'
                 || item.task_data::text,
                 E'\n' order by item.task_id collate "C"
               )) as checksum,
               max(item.task_updated_at) as maximum_updated_at,
               sum(octet_length(jsonb_build_object(
                 'kind', 'tasks',
                 'id', item.task_id,
                 'data', item.task_data,
                 'updatedAt', item.task_updated_at,
                 'deleted', false
               )::text))::bigint as expanded_bytes
          from pg_temp.routino_restore_items item
         group by item.archive_id
      ) calculated on calculated.archive_id = archive.archive_id
     where calculated.item_count not between 1 and 32
        or (archive.archive_data->>'count')::integer is distinct from calculated.item_count
        or jsonb_array_length(archive.archive_data->'items') is distinct from calculated.item_count
        or archive.archive_data->>'checksum' is distinct from calculated.checksum
        or archive.archive_id is distinct from
             archive.archive_data->>'monthKey' || '|' || calculated.id_checksum
        or archive.archive_updated_at is distinct from calculated.maximum_updated_at
        or calculated.expanded_bytes > 98304
  ) then
    raise exception 'task archive restore refused: archive verification failed';
  end if;
  if exists (
    select 1
      from pg_temp.routino_restore_archives archive
     where not exists (
       select 1 from pg_temp.routino_restore_items item
        where item.archive_id = archive.archive_id
     )
  ) then
    raise exception 'task archive restore refused: empty archive';
  end if;

  perform ordinary.id
    from records ordinary
   where ordinary.user_id = v_owner_id
     and ordinary.kind = 'tasks'
     and exists (
       select 1 from pg_temp.routino_restore_items item
        where item.task_id = ordinary.id
     )
   order by ordinary.id
   for update;
  if exists (
    select 1
      from records ordinary
      join pg_temp.routino_restore_items archived on archived.task_id = ordinary.id
     where ordinary.user_id = v_owner_id
       and ordinary.kind = 'tasks'
       and ordinary.deleted = false
       and not coalesce(
         routino_task_archive_candidate_valid(ordinary.id, ordinary.data),
         false
       )
  ) then
    raise exception 'task archive restore refused: malformed ordinary collision';
  end if;
  if exists (
    select 1
      from records ordinary
      join pg_temp.routino_restore_items archived on archived.task_id = ordinary.id
     where ordinary.user_id = v_owner_id
       and ordinary.kind = 'tasks'
       and ordinary.updated_at = archived.task_updated_at
       and ordinary.deleted = false
       and ordinary.data is distinct from archived.task_data
  ) then
    raise exception 'task archive restore refused: ambiguous equal-version collision';
  end if;

  create temp table routino_restore_expected (
    task_id text primary key,
    task_updated_at bigint not null,
    task_deleted boolean not null,
    task_data jsonb,
    winner_source text not null
  ) on commit drop;
  insert into pg_temp.routino_restore_expected
    (task_id, task_updated_at, task_deleted, task_data, winner_source)
  select distinct on (candidate.task_id)
         candidate.task_id,
         candidate.task_updated_at,
         candidate.task_deleted,
         candidate.task_data,
         candidate.winner_source
    from (
      select item.task_id,
             item.task_updated_at,
             false as task_deleted,
             item.task_data,
             'archive'::text as winner_source,
             0 as source_priority
        from pg_temp.routino_restore_items item
      union all
      select ordinary.id,
             ordinary.updated_at,
             ordinary.deleted,
             ordinary.data,
             'ordinary',
             1
        from records ordinary
       where ordinary.user_id = v_owner_id
         and ordinary.kind = 'tasks'
         and exists (
           select 1 from pg_temp.routino_restore_items item
            where item.task_id = ordinary.id
         )
    ) candidate
   order by candidate.task_id,
            candidate.task_updated_at desc,
            candidate.task_deleted desc,
            candidate.source_priority desc;

  v_seq_base := v_owner_seq;
  select count(*)::integer
    into v_apply_count
    from pg_temp.routino_restore_expected expected
   where expected.winner_source = 'archive';
  select count(*)::integer
    into v_insert_count
    from pg_temp.routino_restore_expected expected
   where expected.winner_source = 'archive'
     and not exists (
       select 1 from records ordinary
        where ordinary.user_id = v_owner_id
          and ordinary.kind = 'tasks'
          and ordinary.id = expected.task_id
     );

  if v_actual_record_count - v_archive_count + v_insert_count not between 0 and 50000 then
    raise exception 'task archive restore refused: final row count exceeds bounds';
  end if;
  if v_seq_base > 9223372036854775807::bigint - v_apply_count::bigint then
    raise exception 'task archive restore refused: sequence space exhausted';
  end if;
  if v_seq_base > 9007199254740991::bigint - v_apply_count::bigint then
    raise exception 'task archive restore refused: sequence range exceeds client safety';
  end if;

  create temp table routino_restore_apply (
    task_id text primary key,
    task_updated_at bigint not null,
    task_data jsonb not null,
    position bigint not null,
    assigned_seq bigint not null
  ) on commit drop;
  insert into pg_temp.routino_restore_apply
    (task_id, task_updated_at, task_data, position, assigned_seq)
  select expected.task_id,
         expected.task_updated_at,
         expected.task_data,
         row_number() over (order by expected.task_id)::bigint,
         v_seq_base + row_number() over (order by expected.task_id)::bigint
    from pg_temp.routino_restore_expected expected
   where expected.winner_source = 'archive'
   order by expected.task_id;

  if exists (
    select 1 from pg_temp.routino_restore_apply apply
     where apply.assigned_seq not between 1 and 9007199254740991
  ) or exists (
    select 1
      from pg_temp.routino_restore_apply apply
      join records existing
        on existing.user_id = v_owner_id and existing.seq = apply.assigned_seq
  ) then
    raise exception 'task archive restore refused: reserved sequence range is unsafe';
  end if;

  -- Temporarily reserve the archive rows in the physical row counter so the
  -- trigger-enforced 50k cap is evaluated against the final representation.
  update users owner
     set seq = v_seq_base + v_apply_count,
         sync_record_count = owner.sync_record_count - v_archive_count
   where owner.id = v_owner_id;
  insert into records (user_id, kind, id, data, updated_at, deleted, seq)
  select v_owner_id,
         'tasks',
         apply.task_id,
         apply.task_data,
         apply.task_updated_at,
         false,
         apply.assigned_seq
    from pg_temp.routino_restore_apply apply
   order by apply.position
  on conflict (user_id, kind, id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at,
        deleted = false,
        seq = excluded.seq
  where excluded.updated_at > records.updated_at;
  get diagnostics v_affected = row_count;
  if v_affected <> v_apply_count then
    raise exception 'task archive restore refused: ordinary upsert count mismatch';
  end if;

  if exists (
    select 1
      from pg_temp.routino_restore_expected expected
      left join records ordinary
        on ordinary.user_id = v_owner_id
       and ordinary.kind = 'tasks'
       and ordinary.id = expected.task_id
     where ordinary.id is null
        or ordinary.updated_at is distinct from expected.task_updated_at
        or ordinary.deleted is distinct from expected.task_deleted
        or ordinary.data is distinct from expected.task_data
  ) then
    raise exception 'task archive restore refused: reconstructed tuple verification failed';
  end if;
  if exists (
    select 1
      from pg_temp.routino_restore_apply apply
      join records ordinary
        on ordinary.user_id = v_owner_id
       and ordinary.kind = 'tasks'
       and ordinary.id = apply.task_id
     where ordinary.seq is distinct from apply.assigned_seq
        or ordinary.seq <= v_seq_base
  ) then
    raise exception 'task archive restore refused: fresh sequence verification failed';
  end if;

  delete from records archive
   using pg_temp.routino_restore_archives expected
   where archive.user_id = v_owner_id
     and archive.kind = 'taskMonths'
     and archive.id = expected.archive_id
     and archive.data is not distinct from expected.archive_data
     and archive.updated_at = expected.archive_updated_at
     and archive.deleted = expected.archive_deleted
     and archive.seq = expected.archive_seq;
  get diagnostics v_affected = row_count;
  if v_affected <> v_archive_count then
    raise exception 'task archive restore refused: archive delete verification failed';
  end if;

  -- Undo the temporary reservation after the delete trigger accounts for the
  -- physical archive removal. Annual usage is intentionally never updated.
  update users owner
     set sync_record_count = owner.sync_record_count + v_archive_count
   where owner.id = v_owner_id;

  if exists (
    select 1
      from pg_temp.routino_restore_archives expected
      join records archive
        on archive.user_id = v_owner_id
       and archive.kind = 'taskMonths'
       and archive.id = expected.archive_id
  ) then
    raise exception 'task archive restore refused: archive remained after delete';
  end if;
  if exists (
    select 1
      from pg_temp.routino_restore_expected expected
      left join records ordinary
        on ordinary.user_id = v_owner_id
       and ordinary.kind = 'tasks'
       and ordinary.id = expected.task_id
     where ordinary.id is null
        or ordinary.updated_at is distinct from expected.task_updated_at
        or ordinary.deleted is distinct from expected.task_deleted
        or ordinary.data is distinct from expected.task_data
  ) then
    raise exception 'task archive restore refused: post-delete tuple verification failed';
  end if;

  select count(record.*)::integer,
         coalesce(sum(octet_length(record.data::text)), 0)::bigint
    into v_actual_record_count, v_actual_data_bytes
    from records record
   where record.user_id = v_owner_id;
  if exists (
    select 1 from users owner
     where owner.id = v_owner_id
       and (
         owner.sync_record_count is distinct from v_actual_record_count
         or owner.sync_data_bytes is distinct from v_actual_data_bytes
       )
  ) then
    raise exception 'task archive restore refused: final lifetime counter mismatch';
  end if;
  if exists (
    select 1 from users owner
     where owner.id = v_owner_id
       and (
          owner.sync_growth_period_started_at is distinct from v_annual_started_at
          or owner.sync_growth_bytes is distinct from v_annual_bytes
          or owner.gc_seq is distinct from v_gc_seq
        )
  ) then
    raise exception 'task archive restore refused: annual usage or GC watermark changed';
  end if;

  raise notice 'task archive restore complete: restored %, retained newer %, deleted archives %',
    v_apply_count,
    (select count(*) from pg_temp.routino_restore_expected where winner_source = 'ordinary'),
    v_archive_count;
end
$restore$;

commit;
