-- Add Goals as an ordinary sync record without rewriting existing records.
-- Build and validate the replacement check before the short catalog swap.
set lock_timeout = '3s';
set statement_timeout = '60s';
begin;
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.records'::regclass
       and conname = 'records_kind_valid_goals'
  ) then
    alter table records add constraint records_kind_valid_goals check (kind in
      ('categories','habits','habitMonths','tasks','goals','timerSessions','journal','taskMonths'))
      not valid;
  end if;
end
$migration$;
commit;

begin;
alter table records validate constraint records_kind_valid_goals;
commit;

begin;
do $migration$
begin
  alter table records drop constraint if exists records_kind_valid;
  alter table records rename constraint records_kind_valid_goals to records_kind_valid;
end
$migration$;
commit;

-- CREATE OR REPLACE preserves the canonical function OIDs and every dependent
-- expression/index. Existing kinds keep the exact deployed codec behavior.
begin;
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
  v_item jsonb;
  v_compact jsonb;
  v_item_extras jsonb;
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
    when 'goals' then
      v_extras := '{}'::jsonb ||
        case when p_data ? 'description' then jsonb_build_object('description', p_data->'description') else '{}'::jsonb end ||
        case when p_data ? 'categoryId' then jsonb_build_object('categoryId', p_data->'categoryId') else '{}'::jsonb end ||
        case when p_data ? 'reminderAt' then jsonb_build_object('reminderAt', p_data->'reminderAt') else '{}'::jsonb end ||
        case when p_data ? 'deadlineAt' then jsonb_build_object('deadlineAt', p_data->'deadlineAt') else '{}'::jsonb end ||
        case when p_data ? 'completedAt' then jsonb_build_object('completedAt', p_data->'completedAt') else '{}'::jsonb end;
      v_cells := '[]'::jsonb;
      for v_item in select value from jsonb_array_elements(p_data->'items') loop
        if v_item->>'kind' = 'source' then
          v_compact := jsonb_build_array('source', v_item->'id', v_item->'sourceType',
            v_item->'sourceId', v_item->'sourceTitleSnapshot', v_item->'measure', v_item->'target',
            v_item->'linkedAt', v_item->'linkedDateKey', v_item->'baselineValue');
          v_item_extras := v_item - array['kind','id','sourceType','sourceId',
            'sourceTitleSnapshot','measure','target','linkedAt','linkedDateKey','baselineValue'];
        elsif v_item->>'kind' = 'custom' then
          case v_item->>'measure'
            when 'binary' then
              v_compact := jsonb_build_array('binary', v_item->'id', v_item->'title', v_item->'value');
              v_item_extras := v_item - array['kind','measure','id','title','value'];
            when 'count' then
              v_compact := jsonb_build_array('count', v_item->'id', v_item->'title',
                v_item->'value', v_item->'target');
              v_item_extras := v_item - array['kind','measure','id','title','value','target'];
            when 'time' then
              v_compact := jsonb_build_array('time', v_item->'id', v_item->'title',
                v_item->'valueMinutes', v_item->'targetMinutes');
              v_item_extras := v_item - array['kind','measure','id','title','valueMinutes','targetMinutes'];
            else raise exception 'invalid goal item';
          end case;
        else raise exception 'invalid goal item';
        end if;
        v_cells := v_cells || jsonb_build_array(v_compact ||
          case when v_item_extras = '{}'::jsonb then '[]'::jsonb else jsonb_build_array(v_item_extras) end);
      end loop;
      v_compact := jsonb_build_array(p_data->'title', p_data->'priority', p_data->'status',
        v_cells, p_data->'createdAt') ||
        case when v_extras = '{}'::jsonb then '[]'::jsonb else jsonb_build_array(v_extras) end;
      -- Avoid losing TOAST compression when a smaller representation crosses
      -- below its threshold. The dual reader accepts either representation.
      v_item := jsonb_set(v_compact, '{3}', p_data->'items');
      if pg_column_size(v_item) > 2000 and pg_column_size(v_compact) < 2048 then
        return v_item;
      end if;
      return v_compact;
    when 'timerSessions' then
      v_extras := '{}'::jsonb ||
        case when p_data ? 'linkedKind' then jsonb_build_object('linkedKind', p_data->'linkedKind') else '{}'::jsonb end ||
        case when p_data ? 'linkedId' then jsonb_build_object('linkedId', p_data->'linkedId') else '{}'::jsonb end ||
        case when p_data ? 'linkedItemId' then jsonb_build_object('linkedItemId', p_data->'linkedItemId') else '{}'::jsonb end ||
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
  v_item jsonb;
  v_compact jsonb;
  v_item_length integer;
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
    when 'goals' then
      if v_length not between 5 and 6 then raise exception 'invalid compact goal'; end if;
      v_cells := '[]'::jsonb;
      for v_item in select value from jsonb_array_elements(p_data->3) loop
        if jsonb_typeof(v_item) = 'object' then
          v_compact := v_item; -- Earlier Goals storage remains readable.
        elsif jsonb_typeof(v_item) = 'array' then
          v_item_length := jsonb_array_length(v_item);
          case v_item->>0
            when 'source' then
              if v_item_length not between 10 and 11 then raise exception 'invalid goal item'; end if;
              v_compact := jsonb_build_object('kind','source','id',v_item->1,
                'sourceType',v_item->2,'sourceId',v_item->3,'sourceTitleSnapshot',v_item->4,
                'measure',v_item->5,'target',v_item->6,'linkedAt',v_item->7,
                'linkedDateKey',v_item->8,'baselineValue',v_item->9) ||
                case when v_item_length = 11 then v_item->10 else '{}'::jsonb end;
            when 'binary' then
              if v_item_length not between 4 and 5 then raise exception 'invalid goal item'; end if;
              v_compact := jsonb_build_object('kind','custom','measure','binary',
                'id',v_item->1,'title',v_item->2,'value',v_item->3) ||
                case when v_item_length = 5 then v_item->4 else '{}'::jsonb end;
            when 'count' then
              if v_item_length not between 5 and 6 then raise exception 'invalid goal item'; end if;
              v_compact := jsonb_build_object('kind','custom','measure','count',
                'id',v_item->1,'title',v_item->2,'value',v_item->3,'target',v_item->4) ||
                case when v_item_length = 6 then v_item->5 else '{}'::jsonb end;
            when 'time' then
              if v_item_length not between 5 and 6 then raise exception 'invalid goal item'; end if;
              v_compact := jsonb_build_object('kind','custom','measure','time',
                'id',v_item->1,'title',v_item->2,'valueMinutes',v_item->3,'targetMinutes',v_item->4) ||
                case when v_item_length = 6 then v_item->5 else '{}'::jsonb end;
            else raise exception 'invalid goal item';
          end case;
        else raise exception 'invalid goal item';
        end if;
        v_cells := v_cells || jsonb_build_array(v_compact);
      end loop;
      return jsonb_build_object('id', p_id, 'title', p_data->0, 'priority', p_data->1,
        'status', p_data->2, 'items', v_cells, 'createdAt', p_data->4) ||
        case when v_length = 6 then p_data->5 else '{}'::jsonb end;
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
commit;
reset lock_timeout;
reset statement_timeout;
