-- Backward-compatible optional task categories.
-- This migration replaces functions only. It does not create tables or indexes,
-- and it never updates, backfills, deletes, or rewrites an existing user row.

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
        case when p_data ? 'archived' then jsonb_build_object('archived', p_data->'archived') else '{}'::jsonb end ||
        case when p_data ? 'deadlineTime' then jsonb_build_object('deadlineTime', p_data->'deadlineTime') else '{}'::jsonb end;
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
        case when p_data ? 'deadlineAt' then jsonb_build_object('deadlineAt', p_data->'deadlineAt') else '{}'::jsonb end ||
        case when p_data ? 'color' then jsonb_build_object('color', p_data->'color') else '{}'::jsonb end ||
        case when p_data ? 'icon' then jsonb_build_object('icon', p_data->'icon') else '{}'::jsonb end ||
        case when p_data ? 'categoryId' then jsonb_build_object('categoryId', p_data->'categoryId') else '{}'::jsonb end;
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
      left join lateral (
        select true as found, expanded.task_data->'categoryId' as category_id
          from records archive
          cross join lateral jsonb_array_elements(archive.data->'items') item
          cross join lateral (
            select routino_expand_task_archive_item(
              archive.data->'v', archive.data->>'monthKey', item
            )->2 as task_data
          ) expanded
         where d.kind = 'tasks'
           and d.deleted = false
           and not (d.data ? 'categoryId')
           and archive.user_id = p_user_id
           and archive.kind = 'taskMonths'
           and archive.deleted = false
           and archive.id like left(d.data->>'dateKey', 7) || '|%'
           and archive.data->>'monthKey' = left(d.data->>'dateKey', 7)
           and item->>0 = d.id
           and expanded.task_data ? 'categoryId'
         order by archive.updated_at desc, archive.id
         limit 1
      ) archived_state on true
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
                 when d.kind = 'tasks'
                  and d.deleted = false
                  and existing.user_id is not null
                  and existing.deleted = false
                  and not (d.data ? 'categoryId')
                  and existing_state.data ? 'categoryId'
                 then d.data || jsonb_build_object('categoryId', existing_state.data->'categoryId')
                 when d.kind = 'tasks'
                  and d.deleted = false
                  and not (d.data ? 'categoryId')
                  and (
                    existing.user_id is null
                    or existing.deleted
                    or not (existing_state.data ? 'categoryId')
                  )
                  and archived_state.found
                 then d.data || jsonb_build_object('categoryId', archived_state.category_id)
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
       'note','unitKind','reminderAt','deadlineAt','color','icon','categoryId'
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
       p_data ? 'deadlineAt'
       and jsonb_typeof(p_data->'deadlineAt') <> 'null'
       and (
         jsonb_typeof(p_data->'deadlineAt') <> 'string'
         or p_data->>'deadlineAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
         or left(p_data->>'deadlineAt', 10) < p_data->>'dateKey'
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
     )
     or (
       p_data ? 'categoryId'
       and jsonb_typeof(p_data->'categoryId') <> 'null'
       and (
         jsonb_typeof(p_data->'categoryId') <> 'string'
         or p_data->>'categoryId' !~ '^[A-Za-z0-9_:.-]{1,128}$'
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

revoke execute on function routino_task_archive_candidate_valid(text, jsonb) from public;

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
  if (p->5) - array['note','unitKind','reminderAt','deadlineAt','color','icon','categoryId'] <> '{}'::jsonb
    then return 'null'::jsonb; end if;
  return jsonb_build_array(p_item->0, p_item->1,
    jsonb_build_object('id', p_item->0, 'dateKey', p_month || '-' || (p->>0),
      'title', p->1, 'type', p->2, 'target', p->3, 'value', p->4, 'done', true) || (p->5));
end;
$function$;

revoke execute on function routino_expand_task_archive_item(jsonb, text, jsonb) from public;
