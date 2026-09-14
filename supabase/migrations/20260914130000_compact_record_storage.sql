-- P1 compact records.data storage. This installs dual-read helpers and compact
-- writes, but intentionally does not run the bounded backfill.


-- Storage-only codec. Legacy objects remain valid; compact arrays are decoded
-- before business logic or wire serialization. Identity fields are derived
-- from the record key and are therefore omitted from compact JSONB.
create or replace function routino_encode_record_data(p_kind text, p_id text, p_data jsonb)
returns jsonb
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $function$
declare
  v_extras jsonb;
  v_cells jsonb;
begin
  if p_kind = 'taskMonths' then return p_data; end if;
  if jsonb_typeof(p_data) = 'null' then return p_data; end if;
  if jsonb_typeof(p_data) = 'array' then return p_data; end if;
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid record storage for %/%', p_kind, p_id;
  end if;

  case p_kind
    when 'categories' then
      return jsonb_build_array(p_data->'nameFa', p_data->'nameEn', p_data->'color',
        p_data->'icon', p_data->'isDefault') ||
        case when p_data ? 'isLimit' then jsonb_build_array(p_data->'isLimit') else '[]'::jsonb end;
    when 'habits' then
      v_extras := '{}'::jsonb ||
        case when p_data ? 'unit' then jsonb_build_object('unit', p_data->'unit') else '{}'::jsonb end ||
        case when p_data ? 'unitKind' then jsonb_build_object('unitKind', p_data->'unitKind') else '{}'::jsonb end ||
        case when p_data ? 'archived' then jsonb_build_object('archived', p_data->'archived') else '{}'::jsonb end;
      return jsonb_build_array(
        p_data->'name', p_data->'categoryId', p_data->'type', p_data->'target',
        jsonb_build_array(p_data->'schedule'->'kind') ||
          case when (p_data->'schedule') ? 'weekdays'
            then jsonb_build_array(p_data->'schedule'->'weekdays') else '[]'::jsonb end,
        p_data->'monthlyGoal', p_data->'reminderTime', p_data->'createdAt'
      ) || case when v_extras = '{}'::jsonb then '[]'::jsonb else jsonb_build_array(v_extras) end;
    when 'habitMonths' then
      select coalesce(jsonb_object_agg(cell.key,
        case when cell.value->>'deleted' = 'true'
          then jsonb_build_array(cell.value->'updatedAt')
          else jsonb_build_array(cell.value->'updatedAt', cell.value->'value', cell.value->'done') ||
            case when cell.value ? 'note' or cell.value ? 'mood'
              then jsonb_build_array(coalesce(cell.value->'note', 'null'::jsonb)) else '[]'::jsonb end ||
            case when cell.value ? 'mood'
              then jsonb_build_array(cell.value->'mood') else '[]'::jsonb end
        end), '{}'::jsonb)
        into v_cells
        from jsonb_each(p_data->'cells') cell;
      return jsonb_build_array(v_cells);
    when 'tasks' then
      v_extras := '{}'::jsonb ||
        case when p_data ? 'note' then jsonb_build_object('note', p_data->'note') else '{}'::jsonb end ||
        case when p_data ? 'unitKind' then jsonb_build_object('unitKind', p_data->'unitKind') else '{}'::jsonb end ||
        case when p_data ? 'reminderAt' then jsonb_build_object('reminderAt', p_data->'reminderAt') else '{}'::jsonb end ||
        case when p_data ? 'color' then jsonb_build_object('color', p_data->'color') else '{}'::jsonb end ||
        case when p_data ? 'icon' then jsonb_build_object('icon', p_data->'icon') else '{}'::jsonb end;
      return jsonb_build_array(p_data->'dateKey', p_data->'title', p_data->'type',
        p_data->'target', p_data->'value', p_data->'done') ||
        case when v_extras = '{}'::jsonb then '[]'::jsonb else jsonb_build_array(v_extras) end;
    when 'timerSessions' then
      v_extras := '{}'::jsonb ||
        case when p_data ? 'linkedKind' then jsonb_build_object('linkedKind', p_data->'linkedKind') else '{}'::jsonb end ||
        case when p_data ? 'linkedId' then jsonb_build_object('linkedId', p_data->'linkedId') else '{}'::jsonb end ||
        case when p_data ? 'linkedLabel' then jsonb_build_object('linkedLabel', p_data->'linkedLabel') else '{}'::jsonb end;
      return jsonb_build_array(p_data->'mode', p_data->'focusSeconds', p_data->'startedAt',
        p_data->'endedAt') ||
        case when v_extras = '{}'::jsonb then '[]'::jsonb else jsonb_build_array(v_extras) end;
    when 'journal' then
      return jsonb_build_array(p_data->'text', p_data->'score', p_data->'mood', p_data->'updatedAt');
    when 'taskMonths' then
      return p_data;
    else
      raise exception 'unknown record kind %', p_kind;
  end case;
end
$function$;

revoke execute on function routino_encode_record_data(text, text, jsonb) from public;

create or replace function routino_decode_record_data(p_kind text, p_id text, p_data jsonb)
returns jsonb
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $function$
declare
  v_length integer;
  v_cells jsonb;
begin
  if p_kind = 'taskMonths' then return p_data; end if;
  if jsonb_typeof(p_data) = 'null' then return p_data; end if;
  if jsonb_typeof(p_data) = 'object' then return p_data; end if;
  if jsonb_typeof(p_data) <> 'array' then
    raise exception 'invalid record storage for %/%', p_kind, p_id;
  end if;
  v_length := jsonb_array_length(p_data);

  case p_kind
    when 'categories' then
      if v_length not between 5 and 6 then raise exception 'invalid compact category'; end if;
      return jsonb_build_object('id', p_id, 'nameFa', p_data->0, 'nameEn', p_data->1,
        'color', p_data->2, 'icon', p_data->3, 'isDefault', p_data->4) ||
        case when v_length = 6 then jsonb_build_object('isLimit', p_data->5) else '{}'::jsonb end;
    when 'habits' then
      if v_length not between 8 and 9 or jsonb_typeof(p_data->4) <> 'array'
         or jsonb_array_length(p_data->4) not between 1 and 2 then
        raise exception 'invalid compact habit';
      end if;
      return jsonb_build_object('id', p_id, 'name', p_data->0, 'categoryId', p_data->1,
        'type', p_data->2, 'target', p_data->3,
        'schedule', jsonb_build_object('kind', p_data->4->0) ||
          case when jsonb_array_length(p_data->4) = 2
            then jsonb_build_object('weekdays', p_data->4->1) else '{}'::jsonb end,
        'monthlyGoal', p_data->5, 'reminderTime', p_data->6, 'createdAt', p_data->7) ||
        case when v_length = 9 then p_data->8 else '{}'::jsonb end;
    when 'habitMonths' then
      if v_length <> 1 or jsonb_typeof(p_data->0) <> 'object' or right(p_id, 8) !~ '^\|[0-9]{4}-[0-9]{2}$' then
        raise exception 'invalid compact habit month';
      end if;
      select coalesce(jsonb_object_agg(cell.key,
        case
          when jsonb_typeof(cell.value) <> 'array' or jsonb_array_length(cell.value) not between 1 and 5
            then null
          when jsonb_array_length(cell.value) = 1
            then jsonb_build_object('updatedAt', cell.value->0, 'deleted', true)
          when jsonb_array_length(cell.value) < 3 then null
          else jsonb_build_object('updatedAt', cell.value->0, 'deleted', false,
                 'value', cell.value->1, 'done', cell.value->2) ||
               case when jsonb_array_length(cell.value) >= 4 and cell.value->3 <> 'null'::jsonb
                 then jsonb_build_object('note', cell.value->3) else '{}'::jsonb end ||
               case when jsonb_array_length(cell.value) >= 5
                 then jsonb_build_object('mood', cell.value->4) else '{}'::jsonb end
        end), '{}'::jsonb)
        into v_cells from jsonb_each(p_data->0) cell;
      if exists (select 1 from jsonb_each(v_cells) cell where cell.value = 'null'::jsonb) then
        raise exception 'invalid compact habit month cell';
      end if;
      return jsonb_build_object('habitId', left(p_id, length(p_id) - 8),
        'monthKey', right(p_id, 7), 'cells', v_cells);
    when 'tasks' then
      if v_length not between 6 and 7 then raise exception 'invalid compact task'; end if;
      return jsonb_build_object('id', p_id, 'dateKey', p_data->0, 'title', p_data->1,
        'type', p_data->2, 'target', p_data->3, 'value', p_data->4, 'done', p_data->5) ||
        case when v_length = 7 then p_data->6 else '{}'::jsonb end;
    when 'timerSessions' then
      if v_length not between 4 and 5 then raise exception 'invalid compact timer session'; end if;
      return jsonb_build_object('id', p_id, 'mode', p_data->0, 'focusSeconds', p_data->1,
        'startedAt', p_data->2, 'endedAt', p_data->3) ||
        case when v_length = 5 then p_data->4 else '{}'::jsonb end;
    when 'journal' then
      if v_length <> 4 then raise exception 'invalid compact journal'; end if;
      return jsonb_build_object('dateKey', p_id, 'text', p_data->0, 'score', p_data->1,
        'mood', p_data->2, 'updatedAt', p_data->3);
    when 'taskMonths' then
      raise exception 'invalid compact task month';
    else
      raise exception 'unknown record kind %', p_kind;
  end case;
end
$function$;

revoke execute on function routino_decode_record_data(text, text, jsonb) from public;

create or replace function routino_compact_record_data_if_lossless(
  p_kind text, p_id text, p_data jsonb
)
returns jsonb
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $function$
declare
  v_compact jsonb;
begin
  v_compact := routino_encode_record_data(p_kind, p_id, p_data);
  if routino_decode_record_data(p_kind, p_id, v_compact) = p_data then
    return v_compact;
  end if;
  return null;
exception when others then
  return null;
end
$function$;

revoke execute on function routino_compact_record_data_if_lossless(text, text, jsonb) from public;

drop index if exists records_task_compaction_eligible;
drop index if exists records_task_compaction_owner_month;
create index records_task_compaction_owner_month
  on records (user_id, (left(routino_decode_record_data(kind, id, data)->>'dateKey', 7)), (id collate "C"))
  include (updated_at)
  where kind = 'tasks' and deleted = false
    and routino_decode_record_data(kind, id, data)->>'done' = 'true';

-- Deliberately bounded and re-runnable. Rows that are already arrays, deleted,
-- or fail an encode/decode equality check are untouched. The normal records
-- usage trigger adjusts sync_data_bytes by the exact storage delta.
create or replace function routino_backfill_compact_records(p_limit integer default 500)
returns table (
  updated_rows integer,
  before_bytes bigint,
  after_bytes bigint,
  remaining_rows bigint,
  skipped_rows bigint
)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
begin
  with targets as materialized (
    select r.user_id, r.kind, r.id, r.data,
           routino_compact_record_data_if_lossless(r.kind, r.id, r.data) as compact_data
      from records r
     where not r.deleted
       and r.kind <> 'taskMonths'
       and jsonb_typeof(r.data) = 'object'
       and routino_compact_record_data_if_lossless(r.kind, r.id, r.data) is not null
     order by r.user_id, r.kind, r.id collate "C"
     limit greatest(1, least(coalesce(p_limit, 500), 1000))
     for update of r skip locked
  ), changed as (
    update records r
       set data = targets.compact_data
      from targets
     where r.user_id = targets.user_id and r.kind = targets.kind and r.id = targets.id
     returning targets.data as old_data, r.data as new_data
  )
  select count(*)::integer,
         coalesce(sum(octet_length(old_data::text)), 0)::bigint,
         coalesce(sum(octet_length(new_data::text)), 0)::bigint
    into updated_rows, before_bytes, after_bytes
    from changed;

  select count(*) filter (
           where routino_compact_record_data_if_lossless(r.kind, r.id, r.data) is not null
         )::bigint,
         count(*) filter (
           where routino_compact_record_data_if_lossless(r.kind, r.id, r.data) is null
         )::bigint
    into remaining_rows, skipped_rows
    from records r
   where not r.deleted and r.kind <> 'taskMonths' and jsonb_typeof(r.data) = 'object';
  return next;
end
$function$;

revoke execute on function routino_backfill_compact_records(integer) from public;

-- Repair aid for rollout verification. It processes a stable, bounded user-id
-- page and recomputes only the two counters derived from records.
create or replace function routino_reconcile_record_storage_counters(
  p_after_user_id uuid default null,
  p_limit integer default 500
)
returns table (user_id uuid, record_count integer, data_bytes bigint)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $function$
  with owners as materialized (
    select u.id
      from users u
     where p_after_user_id is null or u.id > p_after_user_id
     order by u.id
     limit greatest(1, least(coalesce(p_limit, 500), 1000))
     for update
  ), actual as (
    select owners.id,
           count(r.*)::integer as record_count,
           coalesce(sum(octet_length(r.data::text)), 0)::bigint as data_bytes
      from owners
      left join records r on r.user_id = owners.id
     group by owners.id
  ), fixed as (
    update users u
       set sync_record_count = actual.record_count,
           sync_data_bytes = actual.data_bytes
      from actual
     where u.id = actual.id
     returning u.id, u.sync_record_count, u.sync_data_bytes
  )
  select fixed.id, fixed.sync_record_count, fixed.sync_data_bytes
    from fixed order by fixed.id
$function$;

revoke execute on function routino_reconcile_record_storage_counters(uuid, integer) from public;

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
             coalesce(octet_length(
               routino_encode_record_data(d.kind, d.id, final.final_data)::text
             ), 0) -
             coalesce(octet_length(existing.data::text), 0),
             0
           )::bigint as positive_growth
      from deduped d
      left join records existing
        on existing.user_id = p_user_id
       and existing.kind = d.kind
       and existing.id = d.id
      cross join lateral (
        select case when existing.data is null then null::jsonb
                    else routino_decode_record_data(existing.kind, existing.id, existing.data)
               end as data
      ) existing_state
      cross join lateral (
        select case
                 when d.kind = 'habitMonths'
                  and d.deleted = false
                  and existing.user_id is not null
                  and existing.deleted = false
                 then jsonb_build_object(
                   'habitId', d.data->'habitId',
                   'monthKey', d.data->'monthKey',
                   'cells', coalesce(existing_state.data->'cells', '{}'::jsonb) || coalesce((
                     select jsonb_object_agg(incoming_cell.key, incoming_cell.value)
                       from jsonb_each(d.data->'cells') incoming_cell
                      where coalesce(
                        (existing_state.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
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
                        (existing_state.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
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
    select p_user_id, accepted.kind, accepted.id,
           case when accepted.data is null then null::jsonb
                else routino_encode_record_data(accepted.kind, accepted.id, accepted.data) end,
           accepted.updated_at, accepted.deleted,
           bump.seq - sized.total + accepted.position
      from accepted cross join sized cross join bump
    on conflict (user_id, kind, id) do update
      set data = excluded.data,
          updated_at = excluded.updated_at,
          deleted = excluded.deleted,
          seq = excluded.seq
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
    select source.user_id,
           left(routino_decode_record_data(source.kind, source.id, source.data)->>'dateKey', 7) as month_key,
           source.updated_at
      from records source
     where source.kind = 'tasks'
       and source.deleted = false
       and routino_decode_record_data(source.kind, source.id, source.data)->>'done' = 'true'
       and routino_task_archive_candidate_valid(
             source.id, routino_decode_record_data(source.kind, source.id, source.data)
           )
       and source.updated_at between 0 and 9007199254740991
       and left(routino_decode_record_data(source.kind, source.id, source.data)->>'dateKey', 7) < to_char(
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
               then archive.data->'items'
               else '[]'::jsonb end
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
-- Normalize one archive item for verification and manual recovery. V1 stays
-- readable. Invalid v2 tuples remain invalid, never repaired or defaulted.
create or replace function routino_expand_task_archive_item(
  p_version jsonb, p_month text, p_item jsonb
)
returns jsonb language plpgsql immutable security invoker
set search_path = public, pg_temp
as $function$
declare
  p jsonb;
begin
  if p_version = '1'::jsonb then return p_item; end if;
  if p_version is distinct from '2'::jsonb then return 'null'::jsonb; end if;
  if jsonb_typeof(p_item) is distinct from 'array' then return 'null'::jsonb; end if;
  if jsonb_array_length(p_item) <> 3 then return 'null'::jsonb; end if;
  p := p_item->2;
  if jsonb_typeof(p) is distinct from 'array' then return 'null'::jsonb; end if;
  if jsonb_array_length(p) <> 6 then return 'null'::jsonb; end if;
  if jsonb_typeof(p->0) is distinct from 'string'
     or (p->>0) !~ '^[0-9]{2}$'
     or jsonb_typeof(p->5) is distinct from 'object' then return 'null'::jsonb; end if;
  if (p->5) - array['note','unitKind','reminderAt','color','icon'] <> '{}'::jsonb
    then return 'null'::jsonb; end if;
  return jsonb_build_array(p_item->0, p_item->1,
    jsonb_build_object('id', p_item->0, 'dateKey', p_month || '-' || (p->>0),
      'title', p->1, 'type', p->2, 'target', p->3, 'value', p->4, 'done', true) || (p->5));
end;
$function$;

-- A short v2 tuple can fall below TOAST's compression threshold while v1 was
-- compressed already, increasing physical storage. Keep those packets as v1.
-- Called on the freshly constructed (uncompressed) JSONB, never a stored datum.
create or replace function routino_task_archive_storage(p_compact jsonb)
returns jsonb language sql immutable strict security invoker
set search_path = public, pg_temp
as $function$
  select case when pg_column_size(p_compact) >= 2048 then p_compact
    else jsonb_set(jsonb_set(p_compact, '{v}', '1'::jsonb), '{items}', (
      select jsonb_agg(routino_expand_task_archive_item('2'::jsonb, p_compact->>'monthKey', item) order by ord)
      from jsonb_array_elements(p_compact->'items') with ordinality as entries(item, ord)
    )) end;
$function$;

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
       and routino_decode_record_data(source.kind, source.id, source.data)->>'done' = 'true'
       and routino_task_archive_candidate_valid(
             source.id, routino_decode_record_data(source.kind, source.id, source.data)
           )
       and source.updated_at between 0 and 9007199254740991
       and left(routino_decode_record_data(source.kind, source.id, source.data)->>'dateKey', 7) < to_char(
         (p_now - interval '7 days') at time zone 'UTC', 'YYYY-MM'
       )
       and source.updated_at <= floor(
         extract(epoch from (p_now - interval '7 days')) * 1000
       )::bigint
       and not exists (
         select 1 from records archive
         cross join lateral jsonb_array_elements(
           case when jsonb_typeof(archive.data->'items') = 'array'
             then archive.data->'items'
             else '[]'::jsonb end
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
           routino_decode_record_data(source.kind, source.id, source.data) as task_data,
           source.updated_at,
           left(routino_decode_record_data(source.kind, source.id, source.data)->>'dateKey', 7) as month_key,
           octet_length(jsonb_build_object(
             'kind', 'tasks',
             'id', source.id,
             'data', routino_decode_record_data(source.kind, source.id, source.data),
             'updatedAt', source.updated_at,
             'deleted', false
           )::text)::integer as envelope_bytes
      from records source
      join locked_owners owner on owner.id = source.user_id
     where source.kind = 'tasks'
       and source.deleted = false
       and routino_decode_record_data(source.kind, source.id, source.data)->>'done' = 'true'
       and routino_task_archive_candidate_valid(
             source.id, routino_decode_record_data(source.kind, source.id, source.data)
           )
       and source.updated_at between 0 and 9007199254740991
       and left(routino_decode_record_data(source.kind, source.id, source.data)->>'dateKey', 7) < to_char(
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
               then archive.data->'items'
               else '[]'::jsonb end
           ) item
          where archive.user_id = source.user_id
            and archive.kind = 'taskMonths'
            and item->>0 = source.id
       )
     order by source.user_id,
              left(routino_decode_record_data(source.kind, source.id, source.data)->>'dateKey', 7),
              source.id collate "C"
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
           v_group.month_key || '|' || md5(string_agg(items.task_id, E'\n' order by items.task_id collate "C")),
           routino_encode_record_data(
             'taskMonths',
             v_group.month_key || '|' || md5(string_agg(items.task_id, E'\n' order by items.task_id collate "C")),
             routino_task_archive_storage(jsonb_build_object(
             'v', 2,
             'monthKey', v_group.month_key,
             'count', count(*)::integer,
             'checksum', md5(string_agg(
               items.task_id || E'\n' || items.updated_at::text || E'\n' || items.task_data::text,
               E'\n' order by items.task_id collate "C"
             )),
             'items', jsonb_agg(
               jsonb_build_array(items.task_id, items.updated_at,
                 jsonb_build_array(right(items.task_data->>'dateKey', 2),
                   items.task_data->'title', items.task_data->'type',
                   items.task_data->'target', items.task_data->'value',
                   items.task_data - array['id','dateKey','title','type','target','value','done']))
               order by items.task_id collate "C"
             )
             ))
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
                 v_group.month_key || '|' || md5(string_agg(items.task_id, E'\n' order by items.task_id collate "C")) as archive_id,
                 count(*)::integer as item_count,
                 md5(string_agg(
                   items.task_id || E'\n' || items.updated_at::text || E'\n' || items.task_data::text,
                   E'\n' order by items.task_id collate "C"
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
           or coalesce(archive.data->'v' not in ('1'::jsonb, '2'::jsonb), true)
           or archive.data->>'monthKey' is distinct from v_group.month_key
           or (archive.data->>'count')::integer is distinct from expected.item_count
           or jsonb_array_length(archive.data->'items') is distinct from expected.item_count
           or archive.data->>'checksum' is distinct from expected.checksum
           or (archive.data->>'count')::integer is distinct from jsonb_array_length(archive.data->'items')
           or archive.data->>'checksum' is distinct from (
             select md5(string_agg(
               item->>0 || E'\n' || (item->>1)::bigint::text || E'\n' ||
                 (routino_expand_task_archive_item(archive.data->'v', archive.data->>'monthKey', item)->2)::text,
               E'\n' order by (item->>0) collate "C"
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
        select item->>0, (item->>1)::bigint,
               routino_expand_task_archive_item(archive.data->'v', archive.data->>'monthKey', item)->2
          from records archive
          join (
            select v_group.month_key || '|' || md5(string_agg(items.task_id, E'\n' order by items.task_id collate "C")) as archive_id
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
        select item->>0, (item->>1)::bigint,
               routino_expand_task_archive_item(archive.data->'v', archive.data->>'monthKey', item)->2
          from records archive
          join (
            select v_group.month_key || '|' || md5(string_agg(items.task_id, E'\n' order by items.task_id collate "C")) as archive_id
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
       and routino_decode_record_data(source.kind, source.id, source.data) = selected.task_data
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
       and routino_decode_record_data(source.kind, source.id, source.data)->>'done' = 'true'
       and routino_task_archive_candidate_valid(
             source.id, routino_decode_record_data(source.kind, source.id, source.data)
           )
       and source.updated_at between 0 and 9007199254740991
       and left(routino_decode_record_data(source.kind, source.id, source.data)->>'dateKey', 7) < to_char(
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
               then archive.data->'items'
               else '[]'::jsonb end
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
