begin;

-- Predicate-only indexes keep both maintenance scans proportional to eligible
-- work. Text extraction is deliberate: malformed legacy JSON is never cast by
-- an index build and remains retained for review.
drop index if exists records_task_compaction_eligible;
create index if not exists records_task_compaction_owner_month
  on records (user_id, (left(data->>'dateKey', 7)), (id collate "C"))
  include (updated_at)
  where kind = 'tasks' and deleted = false and data->>'done' = 'true';

create index if not exists records_tombstone_purge
  on records (updated_at, seq)
  where deleted = true;

-- Protocol-v2 cursor admission and its write are serialized by the same owner
-- lock. Cursorless legacy push fails closed after this owner has GC history.
create or replace function routino_sync_push_if_current(
  p_user_id uuid,
  p_now timestamptz,
  p_incoming jsonb,
  p_cursor bigint
)
returns table (
  cursor bigint,
  applied bigint,
  skipped bigint,
  quota_rejected jsonb,
  batch_accepted boolean
)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_gc_seq bigint;
begin
  select u.gc_seq
    into v_gc_seq
    from users u
   where u.id = p_user_id
   for update;
  if not found then
    raise exception 'unknown sync user';
  end if;

  if p_cursor is null and v_gc_seq > 0 then
    raise exception using
      errcode = '55000',
      message = 'cursorless sync push requires a full protocol-v2 resync';
  end if;

  if p_cursor is not null and p_cursor > 0 and p_cursor < v_gc_seq then
    return query select 0::bigint, 0::bigint, 0::bigint, '[]'::jsonb, false;
    return;
  end if;

  return query
  select pushed.cursor, pushed.applied, pushed.skipped,
         pushed.quota_rejected, true
    from routino_push_records(p_user_id, p_now, p_incoming) pushed;
end
$function$;

revoke execute on function routino_sync_push_if_current(
  uuid, timestamptz, jsonb, bigint
) from public;

create or replace function routino_task_compaction_backlog(p_now timestamptz)
returns table (
  eligible_tasks bigint,
  candidate_owner_months bigint,
  oldest_eligible_at bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
  with eligible as materialized (
    select source.user_id, left(source.data->>'dateKey', 7) as month_key,
           source.updated_at
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
  )
  select count(*)::bigint,
         count(distinct (eligible.user_id, eligible.month_key))::bigint,
         min(eligible.updated_at)::bigint
    from eligible
$function$;

-- Keep the proven archive writer unchanged. This wrapper admits one worker and
-- performs at most two of its existing 500-row verified chunks per transaction.
create or replace function routino_run_task_month_compaction(
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
  v_remaining integer := greatest(1, least(coalesce(p_max_tasks, 1), 1000));
  v_processed integer;
  v_result record;
begin
  if not pg_try_advisory_xact_lock(1919905903, 1) then
    return;
  end if;

  if not exists (
    select 1
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
     limit 1
  ) then
    return;
  end if;

  while v_remaining > 0 loop
    v_processed := 0;
    for v_result in
      select * from routino_compact_task_months(p_now, least(v_remaining, 500))
    loop
      owner_id := v_result.owner_id;
      month_key := v_result.month_key;
      archived_tasks := v_result.archived_tasks;
      archive_rows := v_result.archive_rows;
      v_processed := v_processed + v_result.archived_tasks;
      return next;
    end loop;
    exit when v_processed = 0;
    v_remaining := v_remaining - v_processed;
  end loop;
end
$function$;

create or replace function routino_purge_tombstones(
  p_now timestamptz,
  p_limit integer
)
returns table (
  purged_records integer,
  affected_users integer
)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_limit integer := greatest(0, least(coalesce(p_limit, 0), 2000));
begin
  purged_records := 0;
  affected_users := 0;
  if v_limit = 0 or not pg_try_advisory_xact_lock(1919905903, 2) then
    return next;
    return;
  end if;

  with candidate_tombstones as materialized (
    select source.user_id
      from records source
     where source.deleted = true
       and source.updated_at < floor(
         extract(epoch from (p_now - interval '90 days')) * 1000
       )::bigint
     order by source.updated_at, source.seq, source.user_id, source.kind, source.id
     limit v_limit
  ), candidate_owners as materialized (
    select candidate.user_id
      from candidate_tombstones candidate
     group by candidate.user_id
     order by candidate.user_id
  ), locked_owners as materialized (
    select owner.id
      from users owner
      join candidate_owners candidate on candidate.user_id = owner.id
     order by owner.id
     for update of owner skip locked
  ), locked as materialized (
    select source.user_id, source.kind, source.id, source.updated_at, source.seq
      from records source
      join locked_owners owner on owner.id = source.user_id
     where source.deleted = true
       and source.updated_at < floor(
         extract(epoch from (p_now - interval '90 days')) * 1000
       )::bigint
     order by source.updated_at, source.seq, source.user_id, source.kind, source.id
     limit v_limit
     for update of source skip locked
  ), doomed as (
    delete from records source
     using locked
     where source.user_id = locked.user_id
       and source.kind = locked.kind
       and source.id = locked.id
       and source.deleted = true
       and source.updated_at = locked.updated_at
       and source.seq = locked.seq
     returning source.user_id, source.seq
  ), highest as (
    select doomed.user_id, max(doomed.seq) as top
      from doomed
     group by doomed.user_id
  ), advanced as (
    update users owner
       set gc_seq = greatest(owner.gc_seq, highest.top)
      from highest
     where owner.id = highest.user_id
     returning owner.id
  )
  select (select count(*)::integer from doomed),
         (select count(*)::integer from advanced)
    into purged_records, affected_users;
  return next;
end
$function$;

revoke execute on function routino_task_compaction_backlog(timestamptz) from public;
revoke execute on function routino_run_task_month_compaction(timestamptz, integer) from public;
revoke execute on function routino_purge_tombstones(timestamptz, integer) from public;

-- Supabase-only scheduling is conditional so the additive migration remains
-- executable in local PostgreSQL/PGlite verification. No maintenance function
-- is invoked by this migration against existing product data.
do $schedule$
begin
  if to_regclass('cron.job') is not null then
    execute $sql$
      select cron.unschedule(jobid)
        from cron.job
       where jobname = 'routino-task-month-compaction'
    $sql$;
    execute $sql$
      select cron.schedule(
        'routino-task-month-compaction',
        '* * * * *',
        $job$begin;
set local statement_timeout = '45000ms';
set local lock_timeout = '1000ms';
select * from routino_run_task_month_compaction(now(), 1000);
commit;$job$
      )
    $sql$;

    execute $sql$
      select cron.unschedule(jobid)
        from cron.job
       where jobname = 'routino-tombstone-purge'
    $sql$;
    execute $sql$
      select cron.schedule(
        'routino-tombstone-purge',
        '*/5 * * * *',
        $job$begin;
set local statement_timeout = '45000ms';
set local lock_timeout = '1000ms';
select * from routino_purge_tombstones(now(), 2000);
commit;$job$
      )
    $sql$;
  end if;
end
$schedule$;

commit;
