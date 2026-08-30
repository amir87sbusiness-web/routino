begin;

lock table users in share row exclusive mode;
lock table records in share row exclusive mode;

-- Allow both shapes only for the duration of this transaction. The final
-- constraint below removes raw daily rows from the protocol permanently.
alter table records drop constraint if exists records_kind_valid;
alter table records add constraint records_kind_valid check (kind in
  ('categories','habits','logs','habitMonths','tasks','timerSessions','journal'));

-- Never guess how to transform malformed history. A failed migration rolls
-- back intact so an operator can inspect the offending rows.
do $$
begin
  if exists (
    select 1 from records
     where kind = 'logs'
       and (
         id !~ '^[A-Za-z0-9_:.-]{1,128}\|[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or case
              when id ~ '^[A-Za-z0-9_:.-]{1,128}\|[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              then to_char(to_date(split_part(id, '|', 2), 'YYYY-MM-DD'), 'YYYY-MM-DD')
                   <> split_part(id, '|', 2)
              else false
            end
         or updated_at < 0
         or (
           deleted = false and (
             data is null
             or data->>'habitId' <> split_part(id, '|', 1)
             or data->>'dateKey' <> split_part(id, '|', 2)
             or jsonb_typeof(data->'value') is distinct from 'number'
             or (data->>'value')::numeric < 0
             or (data->>'value')::numeric > 1000000000
             or jsonb_typeof(data->'done') is distinct from 'boolean'
             or (data ? 'note' and jsonb_typeof(data->'note') is distinct from 'string')
             or length(coalesce(data->>'note', '')) > 4000
             or (data ? 'mood' and jsonb_typeof(data->'mood') is distinct from 'string')
             or length(coalesce(data->>'mood', '')) > 32
             or data - 'habitId' - 'dateKey' - 'value' - 'done' - 'note' - 'mood'
                <> '{}'::jsonb
           )
         )
       )
  ) then
    raise exception 'malformed legacy habit logs require review before month compaction';
  end if;
end
$$;

-- Materialize daily rows first, then write one complete row per habit-month.
-- New month rows receive sequence numbers above the old account cursor. gc_seq
-- is raised to the old cursor so a device that had only part of the legacy log
-- performs a safe full reset; a fully caught-up device pulls the new month rows.
with source as materialized (
  select user_id,
         split_part(id, '|', 1) as habit_id,
         substring(split_part(id, '|', 2), 1, 7) as month_key,
         split_part(id, '|', 2) as date_key,
         data,
         updated_at,
         deleted
    from records
   where kind = 'logs'
), months as (
  select user_id,
         habit_id,
         month_key,
         jsonb_build_object(
           'habitId', habit_id,
           'monthKey', month_key,
           'cells', jsonb_object_agg(
             substring(date_key, 9, 2),
             case when deleted then
               jsonb_build_object('updatedAt', updated_at, 'deleted', true)
             else
               jsonb_strip_nulls(jsonb_build_object(
                 'updatedAt', updated_at,
                 'deleted', false,
                 'value', data->'value',
                 'done', data->'done',
                 'note', data->'note',
                 'mood', data->'mood'
               ))
             end
             order by date_key
           )
         ) as data,
         max(updated_at) as updated_at
    from source
   group by user_id, habit_id, month_key
), numbered as (
  select months.*,
         row_number() over (partition by user_id order by habit_id, month_key) as ord,
         count(*) over (partition by user_id) as total
    from months
), bumped as (
  update users u
     set gc_seq = greatest(u.gc_seq, u.seq),
         seq = u.seq + counts.total
    from (
      select user_id, max(total) as total
        from numbered
       group by user_id
    ) counts
   where u.id = counts.user_id
  returning u.id as user_id, u.seq
), inserted as (
  insert into records (user_id, kind, id, data, updated_at, deleted, seq)
  select n.user_id,
         'habitMonths',
         n.habit_id || '|' || n.month_key,
         n.data,
         n.updated_at,
         false,
         b.seq - n.total + n.ord
    from numbered n
    join bumped b on b.user_id = n.user_id
  on conflict (user_id, kind, id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at,
        deleted = false,
        seq = excluded.seq
  returning user_id
), removed as (
  delete from records legacy
   where legacy.kind = 'logs'
     and exists (select 1 from inserted where inserted.user_id = legacy.user_id)
  returning 1
)
select (select count(*) from inserted) as inserted_months,
       (select count(*) from removed) as removed_days;

alter table records drop constraint if exists records_kind_valid;
alter table records add constraint records_kind_valid check (kind in
  ('categories','habits','habitMonths','tasks','timerSessions','journal'));

commit;
