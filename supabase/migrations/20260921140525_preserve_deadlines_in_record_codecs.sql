-- Backward-compatible deadline support for compact record storage.
-- This migration replaces codec/validation functions only. It does not update,
-- backfill, delete, or rewrite any existing user row.

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
    else
      raise exception 'unknown record kind %', p_kind;
  end case;
end
$function$;

revoke execute on function routino_encode_record_data(text, text, jsonb) from public;

create or replace function routino_task_archive_candidate_valid(p_id text, p_data jsonb)
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
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 20480 then return false; end if;
  if p_id !~ '^[A-Za-z0-9_:.-]{1,128}$'
     or not (p_data ?& array['id','dateKey','title','type','target','value','done'])
     or p_data - array['id','dateKey','title','type','target','value','done','note','unitKind','reminderAt','deadlineAt','color','icon'] <> '{}'::jsonb
     or jsonb_typeof(p_data->'id') <> 'string' or p_data->>'id' <> p_id
     or jsonb_typeof(p_data->'dateKey') <> 'string' or p_data->>'dateKey' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or jsonb_typeof(p_data->'title') <> 'string' or routino_js_string_length(p_data->>'title') not between 1 and 256
     or jsonb_typeof(p_data->'type') <> 'string' or p_data->>'type' not in ('binary', 'quantity')
     or jsonb_typeof(p_data->'target') <> 'number' or (p_data->>'target')::numeric not between 0 and 1000000000
     or jsonb_typeof(p_data->'value') <> 'number' or (p_data->>'value')::numeric not between 0 and 1000000000
     or jsonb_typeof(p_data->'done') <> 'boolean'
     or (p_data ? 'note' and (jsonb_typeof(p_data->'note') <> 'string' or routino_js_string_length(p_data->>'note') > 4000))
     or (p_data ? 'unitKind' and (jsonb_typeof(p_data->'unitKind') <> 'string' or p_data->>'unitKind' not in ('count', 'time')))
     or (p_data ? 'reminderAt' and jsonb_typeof(p_data->'reminderAt') <> 'null' and (jsonb_typeof(p_data->'reminderAt') <> 'string' or routino_js_string_length(p_data->>'reminderAt') > 64))
     or (p_data ? 'deadlineAt' and jsonb_typeof(p_data->'deadlineAt') <> 'null' and (jsonb_typeof(p_data->'deadlineAt') <> 'string' or p_data->>'deadlineAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]$' or left(p_data->>'deadlineAt', 10) < p_data->>'dateKey'))
     or (p_data ? 'color' and (jsonb_typeof(p_data->'color') <> 'string' or routino_js_string_length(p_data->>'color') > 32))
     or (p_data ? 'icon' and (jsonb_typeof(p_data->'icon') <> 'string' or routino_js_string_length(p_data->>'icon') > 64)) then
    return false;
  end if;
  v_year := substring(p_data->>'dateKey' from 1 for 4)::integer;
  v_month := substring(p_data->>'dateKey' from 6 for 2)::integer;
  v_day := substring(p_data->>'dateKey' from 9 for 2)::integer;
  if v_month not between 1 and 12 then return false; end if;
  v_max_day := case v_month when 2 then case when v_year % 4 = 0 and (v_year % 100 <> 0 or v_year % 400 = 0) then 29 else 28 end when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end;
  return v_day between 1 and v_max_day;
exception when others then
  return false;
end
$function$;

revoke execute on function routino_task_archive_candidate_valid(text, jsonb) from public;

create or replace function routino_expand_task_archive_item(p_version jsonb, p_month text, p_item jsonb)
returns jsonb language plpgsql immutable security invoker
set search_path = public, pg_temp
as $function$
declare
  p jsonb;
begin
  if p_version = '1'::jsonb then return p_item; end if;
  if p_version is distinct from '2'::jsonb or jsonb_typeof(p_item) is distinct from 'array' or jsonb_array_length(p_item) <> 3 then return 'null'::jsonb; end if;
  p := p_item->2;
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) <> 6 then return 'null'::jsonb; end if;
  if jsonb_typeof(p->0) is distinct from 'string' or (p->>0) !~ '^[0-9]{2}$' or jsonb_typeof(p->5) is distinct from 'object' then return 'null'::jsonb; end if;
  if (p->5) - array['note','unitKind','reminderAt','deadlineAt','color','icon'] <> '{}'::jsonb then return 'null'::jsonb; end if;
  return jsonb_build_array(p_item->0, p_item->1,
    jsonb_build_object('id', p_item->0, 'dateKey', p_month || '-' || (p->>0),
      'title', p->1, 'type', p->2, 'target', p->3, 'value', p->4, 'done', true) || (p->5));
end;
$function$;

revoke execute on function routino_expand_task_archive_item(jsonb, text, jsonb) from public;
