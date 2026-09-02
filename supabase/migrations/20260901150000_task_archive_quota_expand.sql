begin;

-- Expand-only rollout for live accounts: no record is rewritten and existing
-- content is grandfathered by starting annual usage at zero.
alter table users add column if not exists
  sync_growth_period_started_at timestamptz not null default now();
alter table users add column if not exists
  sync_growth_bytes bigint not null default 0;

alter table users drop constraint if exists users_sync_data_bytes_bounds;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_sync_data_bytes_nonnegative'
  ) then
    alter table users add constraint users_sync_data_bytes_nonnegative
      check (sync_data_bytes >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'users_sync_growth_bytes_bounds'
  ) then
    alter table users add constraint users_sync_growth_bytes_bounds
      check (sync_growth_bytes between 0 and 10485760);
  end if;
end
$$;

alter table records drop constraint if exists records_kind_valid;
alter table records add constraint records_kind_valid check (kind in
  ('categories','habits','habitMonths','tasks','timerSessions','journal','taskMonths'));

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

commit;
