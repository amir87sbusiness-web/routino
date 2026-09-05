begin;

-- Replace the earlier month-first candidate index with the order the compactor
-- actually consumes: owner, month, stable task id. updated_at remains covered
-- without becoming an ordering key, and only completed task rows pay the cost.
drop index if exists records_task_compaction_eligible;
create index if not exists records_task_compaction_owner_month
  on records (user_id, (left(data->>'dateKey', 7)), (id collate "C"))
  include (updated_at)
  where kind = 'tasks' and deleted = false and data->>'done' = 'true';

-- Protocol-v2 cursor admission and its write are serialized by one owner lock.
-- Cursorless legacy push fails closed once this owner has any GC history.
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

-- Preselect at most p_limit indexed tombstones, lock their owners first, then
-- lock/delete record versions. Foreground sync takes the same owner lock first.
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

revoke execute on function routino_purge_tombstones(timestamptz, integer) from public;

-- Replace both schedules without running either maintenance function inside the
-- migration transaction. Each future invocation is wall-clock/lock bounded;
-- transaction advisory locks in the functions prevent overlap.
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
