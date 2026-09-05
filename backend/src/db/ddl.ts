/**
 * Schema DDL, shared by the dev bootstrap and the test harness so the two can
 * never drift apart.
 *
 * `if not exists` throughout, so it is safe to run on every boot.
 *
 * No pgcrypto: `gen_random_uuid()` has been in Postgres core since v13, and both
 * PGlite and the postgres:17 image are well past that.
 *
 * For the real deployment, `drizzle-kit generate` produces versioned migrations
 * from `schema.ts`; this exists so a developer can go from `git clone` to a
 * running server with nothing installed.
 */
export const SCHEMA_SQL = `
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  username text,
  password_hash text,
  seq bigint not null default 0,
  gc_seq bigint not null default 0,
  sync_record_count integer not null default 0,
  sync_data_bytes bigint not null default 0,
  active_days integer not null default 0,
  last_active_at timestamptz,
  sync_growth_period_started_at timestamptz not null default now(),
  sync_growth_bytes bigint not null default 0,
  constraint users_sync_record_count_bounds check
    (sync_record_count between 0 and 50000),
  constraint users_sync_data_bytes_nonnegative check (sync_data_bytes >= 0),
  constraint users_active_days_nonnegative check (active_days >= 0),
  constraint users_sync_growth_bytes_bounds check
    (sync_growth_bytes between 0 and 10485760),
  created_at timestamptz not null default now()
);
-- Pre-launch cleanup: these fields and tables are no longer part of the product.
drop table if exists device_security_events;
drop table if exists devices;
alter table users drop column if exists blocked;
alter table users drop column if exists max_active_devices;
alter table users drop column if exists security_locked_at;
alter table users drop column if exists security_lock_reason;
alter table users drop column if exists device_switch_reset_at;

create table if not exists records (
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb,
  updated_at bigint not null,
  deleted boolean not null default false,
  seq bigint not null,
  primary key (user_id, kind, id),
  constraint records_kind_valid check (kind in
    ('categories','habits','habitMonths','tasks','timerSessions','journal','taskMonths'))
);
delete from records where kind = 'settings';
alter table records drop constraint if exists records_kind_valid;
alter table records add constraint records_kind_valid check (kind in
  ('categories','habits','habitMonths','tasks','timerSessions','journal','taskMonths'));
create index if not exists records_pull on records (user_id, seq);
drop index if exists records_task_compaction_eligible;
create index if not exists records_task_compaction_owner_month
  on records (user_id, (left(data->>'dateKey', 7)), (id collate "C"))
  include (updated_at)
  where kind = 'tasks' and deleted = false and data->>'done' = 'true';
create index if not exists records_tombstone_purge
  on records (updated_at, seq)
  where deleted = true;

-- Exact per-account storage accounting. Existing databases are backfilled only
-- while the trigger set is absent; normal boots see the triggers and skip the
-- aggregate scan entirely. Statement-level transition tables update each user
-- once per INSERT/UPDATE/DELETE statement, not once per record in a batch.
alter table users add column if not exists sync_record_count integer not null default 0;
alter table users add column if not exists sync_data_bytes bigint not null default 0;
alter table users add column if not exists active_days integer not null default 0;
alter table users add column if not exists last_active_at timestamptz;
alter table users add column if not exists
  sync_growth_period_started_at timestamptz not null default now();
alter table users add column if not exists sync_growth_bytes bigint not null default 0;
alter table users drop constraint if exists users_sync_data_bytes_bounds;
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname in (
       'records_sync_usage_after_insert',
       'records_sync_usage_after_update',
       'records_sync_usage_after_delete'
     ) and not tgisinternal
  ) then
    update users u
       set sync_record_count = usage.record_count,
           sync_data_bytes = usage.data_bytes
      from (
        select u0.id,
               count(r.*)::integer as record_count,
               coalesce(sum(octet_length(r.data::text)), 0)::bigint as data_bytes
          from users u0
          left join records r on r.user_id = u0.id
         group by u0.id
      ) usage
     where u.id = usage.id;
  end if;
end
$$;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_sync_record_count_bounds') then
    alter table users add constraint users_sync_record_count_bounds check
      (sync_record_count between 0 and 50000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_sync_data_bytes_nonnegative') then
    alter table users add constraint users_sync_data_bytes_nonnegative check
      (sync_data_bytes >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_sync_growth_bytes_bounds') then
    alter table users add constraint users_sync_growth_bytes_bounds check
      (sync_growth_bytes between 0 and 10485760);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_active_days_nonnegative') then
    alter table users add constraint users_active_days_nonnegative check (active_days >= 0);
  end if;
end
$$;

create or replace function routino_records_usage_after_insert()
returns trigger language plpgsql as $$
begin
  update users u
     set sync_record_count = u.sync_record_count + delta.record_count,
         sync_data_bytes = u.sync_data_bytes + delta.data_bytes
    from (
      select user_id,
             count(*)::integer as record_count,
             coalesce(sum(octet_length(data::text)), 0)::bigint as data_bytes
        from new_rows
       group by user_id
    ) delta
   where u.id = delta.user_id;
  return null;
end
$$;

create or replace function routino_records_usage_after_update()
returns trigger language plpgsql as $$
begin
  update users u
     set sync_record_count = u.sync_record_count + delta.record_count,
         sync_data_bytes = u.sync_data_bytes + delta.data_bytes
    from (
      select user_id,
             sum(record_delta)::integer as record_count,
             sum(byte_delta)::bigint as data_bytes
        from (
          select user_id, -1 as record_delta,
                 -coalesce(octet_length(data::text), 0)::bigint as byte_delta
            from old_rows
          union all
          select user_id, 1 as record_delta,
                 coalesce(octet_length(data::text), 0)::bigint as byte_delta
            from new_rows
        ) changes
       group by user_id
    ) delta
   where u.id = delta.user_id
     and (delta.record_count <> 0 or delta.data_bytes <> 0);
  return null;
end
$$;

create or replace function routino_records_usage_after_delete()
returns trigger language plpgsql as $$
begin
  update users u
     set sync_record_count = u.sync_record_count - delta.record_count,
         sync_data_bytes = u.sync_data_bytes - delta.data_bytes
    from (
      select user_id,
             count(*)::integer as record_count,
             coalesce(sum(octet_length(data::text)), 0)::bigint as data_bytes
        from old_rows
       group by user_id
    ) delta
   where u.id = delta.user_id;
  return null;
end
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'records_sync_usage_after_insert') then
    create trigger records_sync_usage_after_insert
      after insert on records
      referencing new table as new_rows
      for each statement execute function routino_records_usage_after_insert();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'records_sync_usage_after_update') then
    create trigger records_sync_usage_after_update
      after update on records
      referencing old table as old_rows new table as new_rows
      for each statement execute function routino_records_usage_after_update();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'records_sync_usage_after_delete') then
    create trigger records_sync_usage_after_delete
      after delete on records
      referencing old table as old_rows
      for each statement execute function routino_records_usage_after_delete();
  end if;
end
$$;

-- One client round trip, two server commands: the first command acquires the
-- per-owner lock; the volatile function's RETURN QUERY then reads a fresh
-- READ COMMITTED snapshot. This avoids the stale statement-snapshot race that
-- a single lock-and-read CTE would have after waiting for another device.
create or replace function routino_push_records(
  p_user_id uuid,
  p_now timestamptz,
  p_incoming jsonb
)
returns table (
  cursor bigint,
  applied bigint,
  skipped bigint,
  quota_rejected jsonb
)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
begin
  perform 1 from users u where u.id = p_user_id for update;
  if not found then
    raise exception 'unknown sync user';
  end if;

  return query
  with recursive incoming (
    kind, id, data, updated_at, original_updated_at, deleted, ord
  ) as (
    select item.value->>'kind',
           item.value->>'id',
           item.value->'data',
           (item.value->>'updatedAt')::bigint,
           (item.value->>'originalUpdatedAt')::bigint,
           (item.value->>'deleted')::boolean,
           item.ord::bigint
      from jsonb_array_elements(p_incoming) with ordinality item(value, ord)
  ),
  cascaded (
    kind, id, data, updated_at, original_updated_at, deleted, ord
  ) as (
    select 'habitMonths'::text, child.id, null::jsonb,
           parent.updated_at, parent.original_updated_at, true,
           jsonb_array_length(p_incoming)::bigint
             + row_number() over (order by child.id)
      from incoming parent
      join records child
        on child.user_id = p_user_id
       and child.kind = 'habitMonths'
       and child.deleted = false
       and child.id like parent.id || '|%'
     where parent.kind = 'habits' and parent.deleted = true
  ),
  deduped as (
    select distinct on (combined.kind, combined.id)
           combined.kind, combined.id, combined.data, combined.updated_at,
           combined.original_updated_at, combined.deleted, combined.ord
      from (
        select * from incoming
        union all
        select * from cascaded
      ) combined
     order by combined.kind, combined.id, combined.updated_at desc,
              combined.deleted desc, combined.ord
  ),
  current_state as (
    select u.sync_growth_period_started_at, u.sync_growth_bytes, u.sync_record_count
      from users u where u.id = p_user_id
  ),
  effective_period as (
    select case
             when cs.sync_growth_period_started_at + interval '365 days' <= p_now
               then p_now
             else cs.sync_growth_period_started_at
           end as period_start,
           case
             when cs.sync_growth_period_started_at + interval '365 days' <= p_now
               then 0::bigint
             else cs.sync_growth_bytes
           end as base_used,
           greatest(50000::bigint - cs.sync_record_count, 0::bigint) as row_slots
      from current_state cs
  ),
  prepared as (
    select d.kind, d.id,
           final.final_data as data,
           final.final_updated_at as updated_at,
           d.original_updated_at,
           final.final_deleted as deleted,
           d.ord,
           (existing.user_id is null) as is_insert,
           decision.will_apply,
           greatest(
             coalesce(octet_length(final.final_data::text), 0) -
             coalesce(octet_length(existing.data::text), 0),
             0
           )::bigint as positive_growth
      from deduped d
      left join records existing
        on existing.user_id = p_user_id
       and existing.kind = d.kind
       and existing.id = d.id
      cross join lateral (
        select case
                 when d.kind = 'habitMonths'
                  and d.deleted = false
                  and existing.user_id is not null
                  and existing.deleted = false
                 then jsonb_build_object(
                   'habitId', d.data->'habitId',
                   'monthKey', d.data->'monthKey',
                   'cells', coalesce(existing.data->'cells', '{}'::jsonb) || coalesce((
                     select jsonb_object_agg(incoming_cell.key, incoming_cell.value)
                       from jsonb_each(d.data->'cells') incoming_cell
                      where coalesce(
                        (existing.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
                        -1
                      ) < (incoming_cell.value->>'updatedAt')::bigint
                   ), '{}'::jsonb)
                 )
                 else d.data
               end as final_data,
               case
                 when d.kind = 'habitMonths'
                  and d.deleted = false
                  and existing.user_id is not null
                  and existing.deleted = false
                 then greatest(existing.updated_at, d.updated_at)
                 else d.updated_at
               end as final_updated_at,
               case
                 when d.kind = 'habitMonths'
                  and d.deleted = false
                  and existing.user_id is not null
                  and existing.deleted = false
                 then false
                 else d.deleted
               end as final_deleted
      ) final
      cross join lateral (
        select case
                 when existing.user_id is null then true
                 when d.kind = 'habitMonths' then case
                   when d.deleted = true or existing.deleted = true
                     then existing.updated_at < d.updated_at
                   else exists (
                     select 1
                       from jsonb_each(d.data->'cells') incoming_cell
                      where coalesce(
                        (existing.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
                        -1
                      ) < (incoming_cell.value->>'updatedAt')::bigint
                   )
                 end
                 else existing.updated_at < d.updated_at
               end as will_apply
      ) decision
  ),
  ranked as (
    select p.*,
           10485760::bigint - ep.base_used as allowance_remaining,
           ep.row_slots
      from prepared p cross join effective_period ep
  ),
  positive_candidates as (
    select r.*,
           row_number() over (order by r.ord, r.kind, r.id)::bigint as budget_position
      from ranked r
     where r.will_apply and r.positive_growth > 0
  ),
  budget_walk as (
    select pc.*,
           (pc.positive_growth <= pc.allowance_remaining) as budget_accepted,
           case when pc.positive_growth <= pc.allowance_remaining
             then pc.positive_growth else 0::bigint end as accepted_growth
      from positive_candidates pc where pc.budget_position = 1
    union all
    select pc.*,
           (walk.accepted_growth + pc.positive_growth <= pc.allowance_remaining),
           case
             when walk.accepted_growth + pc.positive_growth <= pc.allowance_remaining
               then walk.accepted_growth + pc.positive_growth
             else walk.accepted_growth
           end
      from budget_walk walk
      join positive_candidates pc
        on pc.budget_position = walk.budget_position + 1
  ),
  budget_accepted_pre as (
    select r.kind, r.id, r.data, r.updated_at, r.original_updated_at,
           r.deleted, r.ord, r.positive_growth, r.is_insert, r.row_slots
      from ranked r
     where r.will_apply and r.positive_growth = 0
    union all
    select walk.kind, walk.id, walk.data, walk.updated_at,
           walk.original_updated_at, walk.deleted, walk.ord, walk.positive_growth,
           walk.is_insert, walk.row_slots
      from budget_walk walk where walk.budget_accepted
  ),
  capacity_candidates as (
    select accepted_pre.*,
           row_number() over (order by accepted_pre.ord, accepted_pre.kind, accepted_pre.id)::bigint as capacity_position
      from budget_accepted_pre accepted_pre
  ),
  capacity_walk as (
    select cc.*,
           (not cc.is_insert or cc.row_slots >= 1) as capacity_accepted,
           case when cc.is_insert and cc.row_slots >= 1 then 1::bigint else 0::bigint end as accepted_inserts
      from capacity_candidates cc where cc.capacity_position = 1
    union all
    select cc.*,
           (not cc.is_insert or walk.accepted_inserts + 1 <= cc.row_slots),
           case
             when cc.is_insert and walk.accepted_inserts + 1 <= cc.row_slots
               then walk.accepted_inserts + 1
             else walk.accepted_inserts
           end
      from capacity_walk walk
      join capacity_candidates cc on cc.capacity_position = walk.capacity_position + 1
  ),
  accepted as (
    select capacity.*,
           row_number() over (
             order by capacity.ord, capacity.kind, capacity.id
           )::bigint as position
      from capacity_walk capacity where capacity.capacity_accepted
  ),
  budget_rejected as (
    select walk.kind, walk.id, walk.original_updated_at, walk.ord
      from budget_walk walk where not walk.budget_accepted
  ),
  capacity_rejected as (
    select walk.kind, walk.id, walk.original_updated_at, walk.ord
      from capacity_walk walk where not walk.capacity_accepted
  ),
  sized as (
    select count(*)::bigint as total,
           coalesce(sum(accepted.positive_growth), 0)::bigint as positive_growth
      from accepted
  ),
  bump as (
    update users u
       set seq = u.seq + sized.total,
           sync_growth_period_started_at = ep.period_start,
           sync_growth_bytes = ep.base_used + sized.positive_growth
      from sized cross join effective_period ep
     where u.id = p_user_id
    returning u.seq,
              u.sync_growth_period_started_at + interval '365 days' as retry_at
  ),
  upserted as (
    insert into records (user_id, kind, id, data, updated_at, deleted, seq)
    select p_user_id, accepted.kind, accepted.id, accepted.data,
           accepted.updated_at, accepted.deleted,
           bump.seq - sized.total + accepted.position
      from accepted cross join sized cross join bump
    on conflict (user_id, kind, id) do update
      set data = case
            when excluded.kind = 'habitMonths'
             and excluded.deleted = false
             and records.deleted = false
            then jsonb_build_object(
              'habitId', excluded.data->'habitId',
              'monthKey', excluded.data->'monthKey',
              'cells', coalesce(records.data->'cells', '{}'::jsonb) || coalesce((
                select jsonb_object_agg(incoming_cell.key, incoming_cell.value)
                  from jsonb_each(excluded.data->'cells') incoming_cell
                 where coalesce(
                   (records.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
                   -1
                 ) < (incoming_cell.value->>'updatedAt')::bigint
              ), '{}'::jsonb)
            )
            else excluded.data
          end,
          updated_at = case
            when excluded.kind = 'habitMonths'
             and excluded.deleted = false
             and records.deleted = false
            then greatest(records.updated_at, excluded.updated_at)
            else excluded.updated_at
          end,
          deleted = case
            when excluded.kind = 'habitMonths'
             and excluded.deleted = false
             and records.deleted = false
            then false
            else excluded.deleted
          end,
          seq = excluded.seq
      where case
        when excluded.kind = 'habitMonths' then case
          when excluded.deleted = true or records.deleted = true
            then records.updated_at < excluded.updated_at
          else exists (
            select 1
              from jsonb_each(excluded.data->'cells') incoming_cell
             where coalesce(
               (records.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
               -1
             ) < (incoming_cell.value->>'updatedAt')::bigint
          )
        end
        else records.updated_at < excluded.updated_at
      end
    returning 1
  )
  select bump.seq,
         (select count(*)::bigint from upserted),
         (select count(*)::bigint from prepared where not prepared.will_apply),
         coalesce((
           select jsonb_agg(
             jsonb_build_object(
               'kind', rejected.kind,
               'id', rejected.id,
               'updatedAt', rejected.original_updated_at,
               'code', 'account_quota_exceeded',
               'retryAt', rejected.retry_at
             ) order by rejected.ord, rejected.kind, rejected.id
           ) from (
             select annual.kind, annual.id, annual.original_updated_at, annual.ord,
                    floor(extract(epoch from bump.retry_at) * 1000)::bigint as retry_at
               from budget_rejected annual cross join bump
             union all
             select row_cap.kind, row_cap.id, row_cap.original_updated_at, row_cap.ord,
                    floor(extract(epoch from (p_now + interval '1 day')) * 1000)::bigint
               from capacity_rejected row_cap
           ) rejected
         ), '[]'::jsonb)
    from bump;
end
$function$;

revoke execute on function routino_push_records(uuid, timestamptz, jsonb) from public;

-- Cursor admission and the write share one transaction and one owner lock.
-- A stale device must be refused before routino_push_records can recreate a
-- tombstone that maintenance already removed. NULL identifies the cursorless
-- legacy endpoint; it remains usable only until this owner has any GC history.
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

-- Exact read-only observability for the same conservative eligibility contract
-- used by the compactor. Invalid legacy tasks and already archived sources are
-- counted as retained review work, never as safe-to-delete backlog.
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

  -- Claim owners before source tasks. Foreground sync takes this same owner
  -- lock first, so a busy owner is skipped without retaining any task locks.
  with candidate_owners as materialized (
    select source.user_id
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
         select 1 from records archive
         cross join lateral jsonb_array_elements(
           case when jsonb_typeof(archive.data->'items') = 'array'
             then archive.data->'items' else '[]'::jsonb end
         ) item
          where archive.user_id = source.user_id
            and archive.kind = 'taskMonths'
            and item->>0 = source.id
       )
     group by source.user_id
     order by source.user_id
     limit v_limit
  ),
  locked_owners as materialized (
    select u.id
      from users u
      join candidate_owners candidate on candidate.user_id = u.id
     order by u.id
     for update of u skip locked
  ),
  locked as (
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
      join locked_owners owner on owner.id = source.user_id
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
     order by source.user_id, left(source.data->>'dateKey', 7), source.id collate "C"
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
    v_chunk := 1;
    v_chunk_count := 0;
    v_chunk_bytes := 0;
    for v_task in
      select selected.*
        from pg_temp.routino_compaction_selected selected
       where selected.user_id = v_group.user_id
         and selected.month_key = v_group.month_key
       order by selected.task_id collate "C"
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
           v_group.month_key || '|' || md5(string_agg(items.task_id, E'\\n' order by items.task_id collate "C")),
           jsonb_build_object(
             'v', 1,
             'monthKey', v_group.month_key,
             'count', count(*)::integer,
             'checksum', md5(string_agg(
               items.task_id || E'\\n' || items.updated_at::text || E'\\n' || items.task_data::text,
               E'\\n' order by items.task_id collate "C"
             )),
             'items', jsonb_agg(
               jsonb_build_array(items.task_id, items.updated_at, items.task_data)
               order by items.task_id collate "C"
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
                 v_group.month_key || '|' || md5(string_agg(items.task_id, E'\\n' order by items.task_id collate "C")) as archive_id,
                 count(*)::integer as item_count,
                 md5(string_agg(
                   items.task_id || E'\\n' || items.updated_at::text || E'\\n' || items.task_data::text,
                   E'\\n' order by items.task_id collate "C"
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
               item->>0 || E'\\n' || (item->>1)::bigint::text || E'\\n' || (item->2)::text,
               E'\\n' order by (item->>0) collate "C"
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
            select v_group.month_key || '|' || md5(string_agg(items.task_id, E'\\n' order by items.task_id collate "C")) as archive_id
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
            select v_group.month_key || '|' || md5(string_agg(items.task_id, E'\\n' order by items.task_id collate "C")) as archive_id
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

-- The scheduled command sets transaction-local timeouts BEFORE it invokes this
-- bounded wrapper. Keeping the call target named makes the cron contract auditable
-- without pretending a timeout set inside an already-running SELECT is enough.
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

  -- Avoid even temporary-table writes when the minute-level scheduler finds no
  -- eligible source. The full compactor repeats every predicate under row lock.
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

-- Deterministic bounded tombstone collection. The delete and each owner's
-- reset watermark advance in one statement/transaction, so an old cursor can
-- never continue past a tombstone that has disappeared.
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

revoke execute on function routino_js_string_length(text) from public;
revoke execute on function routino_task_archive_candidate_valid(text, jsonb) from public;
revoke execute on function routino_task_compaction_backlog(timestamptz) from public;
revoke execute on function routino_compact_task_months(timestamptz, integer) from public;
revoke execute on function routino_run_task_month_compaction(timestamptz, integer) from public;
revoke execute on function routino_purge_tombstones(timestamptz, integer) from public;

create table if not exists otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists otp_phone_recent on otp_codes (phone, created_at);
create index if not exists otp_ip_recent on otp_codes (ip, created_at);
-- Supports the bounded 24h housekeeping scan.
create index if not exists otp_recent on otp_codes (created_at);

create table if not exists provider_capacity_leases (
  kind text not null,
  lease_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (kind, lease_id)
);
create index if not exists provider_capacity_leases_expiry
  on provider_capacity_leases (kind, expires_at);

create table if not exists auth_rate_limit_buckets (
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_start),
  constraint auth_rate_limit_buckets_count_positive check (count >= 1)
);
create index if not exists auth_rate_limit_buckets_expiry
  on auth_rate_limit_buckets (expires_at);

create table if not exists plans (
  id text primary key,
  name_fa text not null,
  name_en text not null,
  months integer not null,
  price_toman integer not null,
  active boolean not null default true
);

create table if not exists discounts (
  code text primary key,
  percent integer not null,
  phone text,
  active boolean not null default true,
  max_uses integer,
  used_count integer not null default 0,
  expires_at timestamptz
);

create table if not exists redemptions (
  code text not null references discounts(code),
  user_id uuid not null references users(id) on delete cascade,
  payment_id uuid,
  created_at timestamptz not null default now(),
  primary key (code, user_id)
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  plan_id text not null,
  months integer not null,
  amount_toman integer not null,
  amount_rial bigint not null,
  discount_code text,
  discount_percent integer,
  offer_percent integer,
  status text not null default 'pending',
  platform text,
  checkout_provider text not null default 'zarinpal',
  attempt_id uuid not null default gen_random_uuid(),
  authority text unique,
  ref_number text,
  card_number text,
  psp_result integer,
  request_started_at timestamptz,
  verify_started_at timestamptz,
  next_verify_at timestamptz,
  verify_attempts integer not null default 0
    constraint payments_verify_attempts_nonnegative check (verify_attempts >= 0),
  paid_at timestamptz,
  verified_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table payments add column if not exists attempt_id uuid;
alter table payments add column if not exists checkout_provider text not null default 'zarinpal';
alter table payments add column if not exists request_started_at timestamptz;
alter table payments add column if not exists verify_started_at timestamptz;
alter table payments add column if not exists next_verify_at timestamptz;
alter table payments add column if not exists verify_attempts integer not null default 0;
update payments set attempt_id = gen_random_uuid() where attempt_id is null;
alter table payments alter column attempt_id set default gen_random_uuid();
alter table payments alter column attempt_id set not null;
do $$
declare
  has_legacy boolean := false;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'provider'
  ) then
    execute $q$
      select exists (
        select 1 from payments
        where provider is not null and provider <> 'zarinpal'
          and applied_at is null and status not in ('failed', 'canceled')
      )
    $q$ into has_legacy;
  end if;
  if not has_legacy and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'track_id'
  ) then
    execute $q$
      select exists (
        select 1 from payments
        where track_id is not null and applied_at is null
          and status not in ('failed', 'canceled')
      )
    $q$
      into has_legacy;
  end if;
  if has_legacy then
    raise exception 'unsettled legacy-provider payments require review before ZarinPal-only cleanup';
  end if;
end
$$;
drop index if exists payments_provider_ref_unique;
alter table payments drop column if exists provider;
alter table payments drop column if exists provider_ref;
alter table payments drop column if exists track_id;
alter table payments drop column if exists psp_status;
create index if not exists payments_user on payments (user_id);
create index if not exists payments_status on payments (status, created_at);
create unique index if not exists payments_user_attempt_unique
  on payments (user_id, attempt_id);
-- Never guess which ambiguous checkout is authoritative. If history already
-- contains two live logical purchases, startup/migration aborts without
-- deleting, merging or terminalising either money row.
do $$
begin
  if exists (
    select 1
      from payments
     where user_id is not null
       and applied_at is null
       and status in ('pending', 'requesting', 'redirected', 'provider_unknown', 'verifying')
     group by user_id, plan_id, amount_toman, coalesce(discount_code, ''),
              coalesce(platform, 'web'), checkout_provider
    having count(*) > 1
  ) then
    raise exception 'duplicate nonterminal logical payments require review before enabling checkout uniqueness';
  end if;
end
$$;
create unique index if not exists payments_nonterminal_checkout_unique
  on payments (
    user_id, plan_id, amount_toman, coalesce(discount_code, ''),
    coalesce(platform, 'web'), checkout_provider
  )
  where user_id is not null
    and applied_at is null
    and status in ('pending', 'requesting', 'redirected', 'provider_unknown', 'verifying');
-- A limited discount code counts the checkouts currently in flight against it
-- (slotsTaken in services/pricing.ts), on the checkout path. Partial, because
-- most payments carry no code at all.
create index if not exists payments_discount on payments (discount_code) where discount_code is not null;

create table if not exists grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  months integer not null default 0,
  days integer not null default 0,
  source text not null,
  payment_id uuid,
  note text,
  expires_before timestamptz,
  expires_after timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists grants_user on grants (user_id);
-- Refuse to install the invariant over ambiguous history. Production operators
-- must inspect duplicate payment grants; startup/migration never deletes money
-- audit rows or guesses which entitlement extension was intended.
do $$
begin
  if exists (
    select 1 from grants
     where payment_id is not null
     group by payment_id
    having count(*) > 1
  ) then
    raise exception 'duplicate grants.payment_id rows must be resolved before enabling uniqueness';
  end if;
end
$$;
create unique index if not exists grants_payment_id_unique
  on grants (payment_id) where payment_id is not null;
-- settleOpenPayments asks "which paid payments have no grant behind them" on the
-- boot path, which is a NOT EXISTS against this column. Partial: admin gifts and
-- trials carry no payment_id and would only bloat it.
create index if not exists grants_payment on grants (payment_id) where payment_id is not null;

create table if not exists entitlements (
  user_id uuid primary key references users(id) on delete cascade,
  plan_id text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  rating integer not null,
  section text,
  comment text,
  at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Anonymous lifetime product counters. No identifier, timestamp, IP, phone or
-- hash is stored here, so an account purge cannot be reversed from this row.
create table if not exists anonymous_counters (
  key text primary key,
  value bigint not null default 0,
  constraint anonymous_counters_value_nonnegative check (value >= 0)
);
insert into anonymous_counters (key, value)
select 'trial_starts', count(*)::bigint from grants where source = 'trial'
on conflict (key) do nothing;

-- One immutable rollout boundary, with no user-linked data. The first schema
-- install records the boundary itself, so even an out-of-order Edge cold start
-- grants the one-time 30-day floor; subsequent boots preserve it.
create table if not exists account_retention_policy (
  key text primary key,
  deployed_at timestamptz not null,
  preexisting_grace_until timestamptz not null,
  constraint account_retention_policy_window_valid check
    (preexisting_grace_until >= deployed_at)
);
with boundary as materialized (select clock_timestamp() as deployed_at)
insert into account_retention_policy (key, deployed_at, preexisting_grace_until)
select 'trial_cleanup_v1', deployed_at, deployed_at + interval '30 days'
  from boundary
on conflict (key) do nothing;

-- Keep every lookup used by the bounded cleanup on an index. The users index
-- supplies the oldest-first candidate scan; the others prevent FK/privacy
-- checks from turning into full-table scans.
create index if not exists users_created_at on users (created_at, id);
create index if not exists redemptions_user on redemptions (user_id);
create index if not exists feedback_user on feedback (user_id) where user_id is not null;
create index if not exists discounts_phone on discounts (phone) where phone is not null;

-- NULL means "protected or inconsistent". Eligibility is deliberately an
-- allow-list: no history at all, or one internally consistent seven-day trial.
create or replace function routino_account_deletion_at(p_user_id uuid)
returns timestamptz
language sql
stable
set search_path = public
as $$
  with account as (
    select id, phone, created_at
      from users
     where id = p_user_id
  ), grant_stats as (
    select
      count(g.id)::integer as grant_count,
      count(g.id) filter (
        where g.source = 'trial'
          and g.payment_id is null
          and g.months = 0
          and g.days = 7
          and g.expires_before is null
          and g.expires_after is not null
      )::integer as valid_trial_count,
      max(g.expires_after) filter (where g.source = 'trial') as trial_expires_at
    from account a
    left join grants g on g.user_id = a.id
  ), state as (
    select
      a.id,
      a.phone,
      a.created_at,
      gs.grant_count,
      gs.valid_trial_count,
      gs.trial_expires_at,
      e.plan_id,
      e.expires_at,
      e.user_id is not null as has_entitlement,
      rp.deployed_at,
      rp.preexisting_grace_until,
      exists (select 1 from payments p where p.user_id = a.id) as has_payment,
      exists (select 1 from redemptions r where r.user_id = a.id) as has_redemption,
      exists (
        select 1 from discounts d
         where d.phone = a.phone
           and (
             d.used_count > 0
             or exists (select 1 from payments p where p.discount_code = d.code)
             or exists (select 1 from redemptions r where r.code = d.code)
           )
      ) as has_private_discount_history
    from account a
    cross join grant_stats gs
    cross join account_retention_policy rp
    left join entitlements e on e.user_id = a.id
    where rp.key = 'trial_cleanup_v1'
  )
  select case
    when has_payment or has_redemption or has_private_discount_history then null
    when grant_count = 0 and not has_entitlement
      then greatest(
        created_at + interval '30 days',
        case when created_at < deployed_at then preexisting_grace_until else '-infinity' end
      )
    when grant_count = 1
      and valid_trial_count = 1
      and has_entitlement
      and plan_id = 'trial'
      and expires_at = trial_expires_at
      then greatest(
        created_at + interval '30 days',
        expires_at,
        case when created_at < deployed_at then preexisting_grace_until else '-infinity' end
      )
    else null
  end
  from state
$$;

-- One invocation is one small transaction. Locked/in-flight accounts are
-- skipped rather than waited on, and eligibility is re-evaluated immediately
-- before deletion. payments keeps its RESTRICT FK as the final financial guard.
create or replace function routino_cleanup_trial_accounts(
  p_limit integer default 100,
  p_now timestamptz default clock_timestamp(),
  p_canary_user_id uuid default null
)
returns table (deleted_count integer)
language plpgsql
set search_path = public
set lock_timeout = '250ms'
set statement_timeout = '5s'
as $$
declare
  candidate record;
  feedback_ids uuid[];
  otp_ids uuid[];
  discount_codes text[];
  removed integer := 0;
  affected integer := 0;
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'cleanup limit must be between 1 and 500';
  end if;

  for candidate in
    select u.id, u.phone
      from users u
     where u.created_at <= p_now - interval '30 days'
       and (p_canary_user_id is null or u.id = p_canary_user_id)
       and routino_account_deletion_at(u.id) <= p_now
     order by u.created_at, u.id
     for update of u skip locked
     limit p_limit
  loop
    -- Capture only rows that existed before the account delete. A fresh OTP for
    -- a same-phone re-registration racing after deletion must not be removed.
    select coalesce(array_agg(f.id), array[]::uuid[])
      into feedback_ids from feedback f where f.user_id = candidate.id;
    select coalesce(array_agg(o.id), array[]::uuid[])
      into otp_ids from otp_codes o where o.phone = candidate.phone;
    select coalesce(array_agg(d.code), array[]::text[])
      into discount_codes from discounts d
     where d.phone = candidate.phone
       and d.used_count = 0
       and not exists (select 1 from payments p where p.discount_code = d.code)
       and not exists (select 1 from redemptions r where r.code = d.code);

    delete from users u
     where u.id = candidate.id
       and routino_account_deletion_at(u.id) <= p_now
       and not exists (select 1 from payments p where p.user_id = u.id)
       and not exists (select 1 from redemptions r where r.user_id = u.id);
    get diagnostics affected = row_count;
    if affected = 1 then
      -- feedback.user_id is SET NULL by the existing FK, so delete the exact
      -- captured rows after the user deletion succeeds. If eligibility changed,
      -- none of these private child rows is touched.
      delete from feedback where id = any(feedback_ids);
      delete from otp_codes where id = any(otp_ids);
      delete from discounts
       where code = any(discount_codes)
         and used_count = 0
         and not exists (select 1 from payments p where p.discount_code = discounts.code)
         and not exists (select 1 from redemptions r where r.code = discounts.code);
      removed := removed + 1;
    end if;
  end loop;

  return query select removed;
end
$$;

revoke execute on function routino_account_deletion_at(uuid) from public;
revoke execute on function routino_cleanup_trial_accounts(integer, timestamptz, uuid) from public;

-- Idempotent upgrades for databases created before a column existed. "create
-- table if not exists" silently skips existing tables, so new columns must be
-- added explicitly here.
alter table payments add column if not exists platform text;
alter table payments add column if not exists authority text;
-- ZarinPal authority is unique per transaction (multiple NULLs are allowed).
create unique index if not exists payments_authority on payments (authority);

-- Password + username sign-in (added after the users table already existed in
-- production). Both nullable: OTP-only accounts keep working untouched.
alter table users add column if not exists username text;
alter table users add column if not exists password_hash text;
-- username unique, but many NULLs allowed (unset accounts). Stored lowercased.
create unique index if not exists users_username on users (username);

-- records_habit indexed (data->>'habitId') for a query that was never written:
-- the habit-delete cascade matches the month id prefix (habitId|YYYY-MM), see
-- childMonthIds in services/sync.ts. An unused index is not free; dropped rather
-- than left "just in case". Re-add it WITH the query that uses it if that changes.
drop index if exists records_habit;
`;

/** Must match `src/lib/presets.ts` PLANS on the client, or the price shown and
 * the price charged diverge. */
export const SEED_PLANS_SQL = `
insert into plans (id, name_fa, name_en, months, price_toman) values
  ('m1',  'یک‌ماهه', '1 Month',  1,  59000),
  ('m3',  'سه‌ماهه', '3 Months', 3,  149000),
  ('m12', 'یک‌ساله', '1 Year',   12, 449000)
on conflict (id) do nothing;
`;

/** A dev-only discount code mirroring the one the client used to bundle. */
export const SEED_DISCOUNTS_SQL = `
insert into discounts (code, percent, active) values ('ROUTINO20', 20, true)
on conflict (code) do nothing;
`;
