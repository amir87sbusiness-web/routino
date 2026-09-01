-- Read-only, secret-safe task archive precheck.
-- Output is limited to counts and hashes. It never selects a task/journal
-- payload, phone, credential, or other private field as an output column.
with archives as (
  select archive.user_id, archive.id as archive_id, archive.data,
         archive.updated_at, archive.deleted, archive.seq
    from records archive
   where archive.kind = 'taskMonths'
), archive_types as (
  select archive.*, jsonb_typeof(archive.data) = 'object' as object_data
    from archives archive
), archive_fields as (
  -- CASE keeps JSON object operations unreachable for scalar data.
  select archive.*,
         case when archive.object_data then archive.data - array['v', 'monthKey', 'count', 'checksum', 'items'] end as extra_fields,
         case when archive.object_data then archive.data->'v' end as version_value,
         case when archive.object_data then archive.data->'monthKey' end as month_key_value,
         case when archive.object_data then archive.data->'count' end as count_value,
         case when archive.object_data then archive.data->'checksum' end as checksum_value,
         case when archive.object_data then archive.data->'items' end as items_value
    from archive_types archive
), archive_shapes as (
  select archive.*,
         jsonb_typeof(archive.month_key_value) = 'string' as month_key_is_string,
         jsonb_typeof(archive.count_value) = 'number' as count_is_number,
         jsonb_typeof(archive.checksum_value) = 'string' as checksum_is_string,
         jsonb_typeof(archive.items_value) = 'array' as items_is_array,
         case when jsonb_typeof(archive.month_key_value) = 'string' then archive.month_key_value #>> '{}' end as month_key_text,
         case when jsonb_typeof(archive.count_value) = 'number' then archive.count_value #>> '{}' end as count_text,
         case when jsonb_typeof(archive.checksum_value) = 'string' then archive.checksum_value #>> '{}' end as checksum_text,
         case when jsonb_typeof(archive.items_value) = 'array' then jsonb_array_length(archive.items_value) end as item_array_length
    from archive_fields archive
), archive_numbers as (
  -- The two-digit lexical bound makes this integer cast intrinsically safe.
  select archive.*,
         case when archive.count_is_number and archive.count_text ~ '^[0-9]{1,2}$'
              then archive.count_text::integer end as count_candidate
    from archive_shapes archive
), archive_bounds as (
  select archive.*,
         case when archive.count_candidate between 1 and 32
              then archive.count_candidate end as safe_count
    from archive_numbers archive
), archive_metadata as (
  select archive.*,
         not coalesce((
           archive.object_data
           and archive.version_value = '1'::jsonb
           and archive.extra_fields = '{}'::jsonb
            and archive.month_key_is_string
            and archive.month_key_text ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
            and archive.count_is_number
            and archive.safe_count is not null
           and archive.checksum_is_string
            and archive.checksum_text ~ '^[a-f0-9]{32}$'
            and archive.items_is_array
            and archive.item_array_length = archive.safe_count
          ), false) as metadata_invalid
    from archive_bounds archive
), archive_items_raw as (
  select archive.user_id, archive.archive_id, archive.seq, archive.metadata_invalid,
         item.value as item
    from archive_metadata archive
    cross join lateral jsonb_array_elements(
      case when not archive.metadata_invalid then archive.items_value else '[]'::jsonb end
    ) item
), archive_item_shapes as (
  select item.*, jsonb_typeof(item.item) = 'array' as tuple_is_array,
         case when jsonb_typeof(item.item) = 'array' then jsonb_array_length(item.item) end as tuple_length
    from archive_items_raw item
), archive_item_fields as (
  select item.*,
         case when item.tuple_is_array and item.tuple_length = 3 then item.item->0 end as id_value,
         case when item.tuple_is_array and item.tuple_length = 3 then item.item->1 end as updated_value,
         case when item.tuple_is_array and item.tuple_length = 3 then item.item->2 end as data_value
    from archive_item_shapes item
), archive_item_numbers as (
  select item.*,
         case when jsonb_typeof(item.id_value) = 'string' then item.id_value #>> '{}' end as task_id,
         case when jsonb_typeof(item.updated_value) = 'number' then item.updated_value #>> '{}' end as updated_text,
          case when jsonb_typeof(item.updated_value) = 'number'
                    and (item.updated_value #>> '{}') ~ '^[0-9]{1,16}$'
               then (item.updated_value #>> '{}')::bigint end as updated_candidate,
          case when jsonb_typeof(item.data_value) = 'object' then item.data_value end as task_data
    from archive_item_fields item
), archive_item_bounds as (
  select item.*,
         case when item.updated_candidate between 0 and 9007199254740991
              then item.updated_candidate end as safe_updated_at
    from archive_item_numbers item
), archive_item_validation as (
  select item.*,
         item.task_id is not null
         and item.safe_updated_at is not null
         and item.task_data is not null
         and coalesce(routino_task_archive_candidate_valid(item.task_id, item.task_data), false) as item_valid
    from archive_item_bounds item
), duplicate_archive_ids as (
  select item.user_id, item.task_id
    from archive_item_validation item
   where item.item_valid
   group by item.user_id, item.task_id
  having count(*) > 1
), invalid_archives as (
  select archive.user_id, archive.archive_id
    from archive_metadata archive
   where archive.metadata_invalid
  union
  select item.user_id, item.archive_id
    from archive_item_validation item
   where not item.item_valid
  union
  select item.user_id, item.archive_id
    from archive_item_validation item
    join duplicate_archive_ids duplicate
      on duplicate.user_id = item.user_id and duplicate.task_id = item.task_id
), valid_archive_items as (
  select item.user_id, item.archive_id, item.seq, item.task_id as id,
         item.safe_updated_at as updated_at, item.task_data as data
    from archive_item_validation item
   where item.item_valid
     and not exists (
       select 1 from invalid_archives invalid
        where invalid.user_id = item.user_id and invalid.archive_id = item.archive_id
     )
), task_candidates as (
  select ordinary.user_id, ordinary.id, ordinary.updated_at, ordinary.deleted,
         ordinary.data, ordinary.seq, 1 as ordinary_priority
    from records ordinary
   where ordinary.kind = 'tasks'
  union all
  select archived.user_id, archived.id, archived.updated_at, false,
         archived.data, archived.seq, 0
    from valid_archive_items archived
), ranked_tasks as (
  select candidate.*, row_number() over (
           partition by candidate.user_id, candidate.id
           order by candidate.updated_at desc, candidate.deleted desc,
                    candidate.ordinary_priority desc, candidate.seq desc
         ) as winner_rank
    from task_candidates candidate
), task_hash as (
  select case when exists (select 1 from invalid_archives) then null::text
              else md5(coalesce(string_agg(
                winner.user_id::text || E'\n' || winner.id || E'\n'
                || winner.updated_at::text || E'\n' || winner.deleted::text || E'\n'
                || coalesce(winner.data::text, 'null'),
                E'\n' order by winner.user_id, winner.id
              ), '')) end as task_semantic_hash
    from ranked_tasks winner
   where winner.winner_rank = 1
), raw_summary as (
  select count(*) filter (where kind = 'tasks') as ordinary_task_rows,
         count(*) filter (where kind = 'taskMonths') as archive_rows,
         count(*) filter (where kind = 'tasks' and deleted = false and data is null) as malformed_live_tasks,
         md5(string_agg(user_id::text || E'\n' || kind || E'\n' || id || E'\n' || updated_at::text || E'\n' || coalesce(data::text, 'null'), E'\n' order by user_id, kind, id)) as records_raw_backup_hash
    from records
), actual_usage as (
  select owner.id as user_id, count(record.*)::integer as record_count,
         coalesce(sum(octet_length(record.data::text)), 0)::bigint as data_bytes,
         coalesce(max(record.seq), 0)::bigint as maximum_record_seq
    from users owner
    left join records record on record.user_id = owner.id
   group by owner.id
), duplicate_record_sequences as (
  select record.user_id, record.seq
    from records record
   group by record.user_id, record.seq
  having count(*) > 1
), counter_bounds as (
  select count(*) filter (where owner.sync_record_count is distinct from actual.record_count) as lifetime_record_counter_mismatches,
         count(*) filter (where owner.sync_data_bytes is distinct from actual.data_bytes) as lifetime_byte_counter_mismatches,
         count(*) filter (where owner.sync_record_count not between 0 and 50000) as lifetime_record_counter_out_of_bounds,
         count(*) filter (where owner.sync_data_bytes < 0) as lifetime_byte_counter_out_of_bounds,
         count(*) filter (where owner.sync_growth_bytes not between 0 and 10485760) as annual_usage_out_of_bounds,
         count(*) filter (where owner.sync_growth_period_started_at is null) as annual_period_start_missing,
         count(*) filter (where owner.sync_growth_period_started_at > now()) as annual_period_start_in_future,
         count(*) filter (where owner.seq not between 0 and 9007199254740991) as sequence_owner_out_of_bounds,
         count(*) filter (where owner.seq < actual.maximum_record_seq) as sequence_owner_behind_records,
         count(*) filter (where owner.gc_seq is null or owner.gc_seq not between 0 and 9007199254740991) as gc_sequence_out_of_bounds,
         count(*) filter (where owner.gc_seq > owner.seq) as gc_sequence_above_owner
    from users owner
    join actual_usage actual on actual.user_id = owner.id
), sequence_bounds as (
  select count(*) filter (where record.seq not between 1 and 9007199254740991) as sequence_record_out_of_bounds,
         (select count(*) from duplicate_record_sequences) as duplicate_record_sequence_groups
    from records record
)
select raw_summary.ordinary_task_rows, raw_summary.archive_rows, raw_summary.malformed_live_tasks,
       raw_summary.records_raw_backup_hash, task_hash.task_semantic_hash,
       (select count(*) from invalid_archives) as invalid_archive_rows,
       counter_bounds.lifetime_record_counter_mismatches,
       counter_bounds.lifetime_byte_counter_mismatches,
       counter_bounds.lifetime_record_counter_out_of_bounds,
       counter_bounds.lifetime_byte_counter_out_of_bounds,
       counter_bounds.annual_usage_out_of_bounds,
       counter_bounds.annual_period_start_missing,
       counter_bounds.annual_period_start_in_future,
       counter_bounds.sequence_owner_out_of_bounds,
       counter_bounds.sequence_owner_behind_records,
       counter_bounds.gc_sequence_out_of_bounds,
       counter_bounds.gc_sequence_above_owner,
       sequence_bounds.sequence_record_out_of_bounds,
       sequence_bounds.duplicate_record_sequence_groups
  from raw_summary
  cross join task_hash
  cross join counter_bounds
  cross join sequence_bounds;
