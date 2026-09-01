-- Read-only, secret-safe task archive precheck.
-- Output is limited to counts and hashes. It never selects a task/journal
-- payload, phone, credential, or other private field as an output column.
with archive_items_raw as (
  select archive.user_id,
         archive.id as archive_id,
         archive.seq,
         item.value as item
    from records archive
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(archive.data) = 'object'
         and jsonb_typeof(archive.data->'items') = 'array'
        then archive.data->'items'
        else '[]'::jsonb
      end
    ) item
   where archive.kind = 'taskMonths'
     and archive.deleted = false
), archive_items_safe as (
  select user_id,
         archive_id,
         seq,
         case
           when jsonb_typeof(item) = 'array'
            and jsonb_array_length(item) = 3
            and jsonb_typeof(item->0) = 'string'
           then item->>0
         end as id,
         case
           when jsonb_typeof(item) = 'array'
            and jsonb_array_length(item) = 3
            and jsonb_typeof(item->1) = 'number'
            and item->>1 ~ '^[0-9]+$'
            and (item->>1)::numeric between 0 and 9007199254740991
           then (item->>1)::bigint
         end as updated_at,
         case
           when jsonb_typeof(item) = 'array'
            and jsonb_array_length(item) = 3
            and jsonb_typeof(item->2) = 'object'
           then item->2
         end as data
    from archive_items_raw
), task_candidates as (
  select ordinary.user_id,
         ordinary.id,
         ordinary.updated_at,
         ordinary.deleted,
         ordinary.data,
         ordinary.seq,
         1 as ordinary_priority
    from records ordinary
   where ordinary.kind = 'tasks'
  union all
  select archived.user_id,
         archived.id,
         archived.updated_at,
         false,
         archived.data,
         archived.seq,
         0
    from archive_items_safe archived
   where archived.id is not null
     and archived.updated_at is not null
     and archived.data is not null
), ranked_tasks as (
  select candidate.*,
         row_number() over (
           partition by candidate.user_id, candidate.id
           order by candidate.updated_at desc,
                    candidate.deleted desc,
                    candidate.ordinary_priority desc,
                    candidate.seq desc
         ) as winner_rank
    from task_candidates candidate
), task_hash as (
  select md5(coalesce(string_agg(
           winner.user_id::text || E'\n' || winner.id || E'\n'
           || winner.updated_at::text || E'\n' || winner.deleted::text || E'\n'
           || coalesce(winner.data::text, 'null'),
           E'\n' order by winner.user_id, winner.id
         ), '')) as task_semantic_hash
    from ranked_tasks winner
   where winner.winner_rank = 1
), raw_summary as (
  select
    count(*) filter (where kind = 'tasks') as ordinary_task_rows,
    count(*) filter (where kind = 'taskMonths') as archive_rows,
    count(*) filter (where kind = 'tasks' and deleted = false and data is null) as malformed_live_tasks,
    md5(string_agg(user_id::text || E'\n' || kind || E'\n' || id || E'\n' || updated_at::text || E'\n' || coalesce(data::text, 'null'), E'\n' order by user_id, kind, id)) as records_raw_backup_hash
  from records
), actual_usage as (
  select owner.id as user_id,
         count(record.*)::integer as record_count,
         coalesce(sum(octet_length(record.data::text)), 0)::bigint as data_bytes
    from users owner
    left join records record on record.user_id = owner.id
   group by owner.id
), counter_bounds as (
  select count(*) filter (
           where owner.sync_record_count is distinct from actual.record_count
         ) as lifetime_record_counter_mismatches,
         count(*) filter (
           where owner.sync_data_bytes is distinct from actual.data_bytes
         ) as lifetime_byte_counter_mismatches,
         count(*) filter (
           where owner.sync_record_count not between 0 and 50000
         ) as lifetime_record_counter_out_of_bounds,
         count(*) filter (
           where owner.sync_data_bytes < 0
         ) as lifetime_byte_counter_out_of_bounds,
         count(*) filter (
           where owner.sync_growth_bytes not between 0 and 10485760
         ) as annual_usage_out_of_bounds,
         count(*) filter (
           where owner.sync_growth_period_started_at is null
         ) as annual_period_start_missing,
         count(*) filter (
           where owner.sync_growth_period_started_at > now()
         ) as annual_period_start_in_future
    from users owner
    join actual_usage actual on actual.user_id = owner.id
)
select raw_summary.ordinary_task_rows,
       raw_summary.archive_rows,
       raw_summary.malformed_live_tasks,
       raw_summary.records_raw_backup_hash,
       task_hash.task_semantic_hash,
       counter_bounds.lifetime_record_counter_mismatches,
       counter_bounds.lifetime_byte_counter_mismatches,
       counter_bounds.lifetime_record_counter_out_of_bounds,
       counter_bounds.lifetime_byte_counter_out_of_bounds,
       counter_bounds.annual_usage_out_of_bounds,
       counter_bounds.annual_period_start_missing,
       counter_bounds.annual_period_start_in_future
  from raw_summary
  cross join task_hash
  cross join counter_bounds;
