-- Read-only, secret-safe postcheck. Every returned count is zero for a healthy
-- archive deployment. No private payload is selected as an output column.
with archives as (
  select archive.user_id, archive.id as archive_id, archive.data,
         archive.updated_at, archive.deleted
    from records archive
   where archive.kind = 'taskMonths'
), archive_types as (
  select archive.*, jsonb_typeof(archive.data) = 'object' as object_data
    from archives archive
), archive_fields as (
  -- CASE guards object subtraction and field reads from scalar JSON values.
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
         case when jsonb_typeof(archive.items_value) = 'array' then jsonb_array_length(archive.items_value) end as item_count
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
            and archive.item_count = archive.safe_count
          ), false) as metadata_invalid
    from archive_bounds archive
), raw_items as (
  select archive.user_id, archive.archive_id, archive.updated_at as archive_updated_at,
         archive.metadata_invalid, item.ordinality, item.value as item
    from archive_metadata archive
    cross join lateral jsonb_array_elements(
      case when not archive.metadata_invalid then archive.items_value else '[]'::jsonb end
    ) with ordinality item(value, ordinality)
), item_shapes as (
  select item.*, jsonb_typeof(item.item) = 'array' as tuple_is_array,
         case when jsonb_typeof(item.item) = 'array' then jsonb_array_length(item.item) end as tuple_length
    from raw_items item
), item_fields as (
  select item.*,
         case when item.tuple_is_array and item.tuple_length = 3 then item.item->0 end as id_value,
         case when item.tuple_is_array and item.tuple_length = 3 then item.item->1 end as updated_value,
         case when item.tuple_is_array and item.tuple_length = 3 then item.item->2 end as data_value
    from item_shapes item
), item_numbers as (
  select item.*,
         case when jsonb_typeof(item.id_value) = 'string' then item.id_value #>> '{}' end as task_id,
         case when jsonb_typeof(item.updated_value) = 'number' then item.updated_value #>> '{}' end as updated_text,
          case when jsonb_typeof(item.updated_value) = 'number'
                    and (item.updated_value #>> '{}') ~ '^[0-9]{1,16}$'
               then (item.updated_value #>> '{}')::bigint end as updated_candidate,
          case when jsonb_typeof(item.data_value) = 'object' then item.data_value end as task_data
    from item_fields item
), item_bounds as (
  select item.*,
         case when item.updated_candidate between 0 and 9007199254740991
              then item.updated_candidate end as safe_updated_at
    from item_numbers item
), item_validation as (
  select item.*,
         case
            when item.task_id is not null
             and item.safe_updated_at is not null
            and item.task_data is not null
           then coalesce(routino_task_archive_candidate_valid(item.task_id, item.task_data), false)
           else false
         end as item_valid
    from item_bounds item
), valid_items as (
  select item.user_id, item.archive_id, item.archive_updated_at, item.task_id,
         item.safe_updated_at as task_updated_at, item.task_data
    from item_validation item
   where item.item_valid
), archive_calculated as (
  select archive.user_id, archive.archive_id,
         count(item.task_id)::integer as valid_item_count,
         md5(string_agg(item.task_id || E'\n' || item.task_updated_at::text || E'\n' || item.task_data::text,
                        E'\n' order by item.task_id)) as calculated_checksum,
         md5(string_agg(item.task_id, E'\n' order by item.task_id)) as id_checksum,
         max(item.task_updated_at) as maximum_updated_at,
         coalesce(sum(octet_length(jsonb_build_object(
           'kind', 'tasks', 'id', item.task_id, 'data', item.task_data,
           'updatedAt', item.task_updated_at, 'deleted', false
         )::text)), 0)::bigint as expanded_bytes
    from archive_metadata archive
    left join valid_items item
      on item.user_id = archive.user_id and item.archive_id = archive.archive_id
   group by archive.user_id, archive.archive_id
), duplicate_archive_ids as (
  select item.user_id, item.task_id
    from valid_items item
   group by item.user_id, item.task_id
  having count(*) > 1
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
), sequence_bounds as (
  select count(*) filter (where record.seq not between 1 and 9007199254740991) as sequence_record_out_of_bounds,
         (select count(*) from duplicate_record_sequences) as duplicate_record_sequence_groups
    from records record
)
select
  (select count(*) from archive_metadata archive
    where archive.version_value is distinct from '1'::jsonb) as unknown_archive_versions,
  (select count(*) from archive_metadata archive
    where archive.metadata_invalid) as malformed_archive_rows,
  (select count(*) from item_validation item where not item.item_valid) as malformed_archive_tuples,
  (select count(*) from duplicate_archive_ids) as duplicate_archived_id_groups,
  (select count(*) from archive_metadata archive
    join archive_calculated calculated using (user_id, archive_id)
   where archive.metadata_invalid
      or calculated.valid_item_count is distinct from archive.item_count) as archive_count_mismatches,
  (select count(*) from archive_metadata archive
    join archive_calculated calculated using (user_id, archive_id)
   where not archive.metadata_invalid
     and archive.checksum_text is distinct from calculated.calculated_checksum) as archive_checksum_mismatches,
  (select count(*) from archive_metadata archive
    join archive_calculated calculated using (user_id, archive_id)
   where not archive.metadata_invalid
     and archive.archive_id is distinct from archive.month_key_text || '|' || calculated.id_checksum) as archive_identity_mismatches,
  (select count(*) from archive_metadata archive
    join archive_calculated calculated using (user_id, archive_id)
   where not archive.metadata_invalid
     and archive.updated_at is distinct from calculated.maximum_updated_at) as archive_updated_at_mismatches,
  (select count(*) from archive_calculated calculated where calculated.expanded_bytes > 98304) as oversized_expanded_archives,
  (select count(*) from valid_items archived
    join records ordinary
      on ordinary.user_id = archived.user_id and ordinary.kind = 'tasks' and ordinary.id = archived.task_id
   where ordinary.updated_at < archived.task_updated_at
      or (ordinary.updated_at = archived.task_updated_at and ordinary.deleted = false and ordinary.data is distinct from archived.task_data)) as ordinary_not_newer_archive_relationships,
  (select count(*) from users owner join actual_usage actual on actual.user_id = owner.id
   where owner.sync_record_count is distinct from actual.record_count) as lifetime_record_counter_mismatches,
  (select count(*) from users owner join actual_usage actual on actual.user_id = owner.id
   where owner.sync_data_bytes is distinct from actual.data_bytes) as lifetime_byte_counter_mismatches,
  (select count(*) from users owner where owner.sync_record_count not between 0 and 50000) as lifetime_record_counter_out_of_bounds,
  (select count(*) from users owner where owner.sync_data_bytes < 0) as lifetime_byte_counter_out_of_bounds,
  (select count(*) from users owner where owner.sync_growth_bytes not between 0 and 10485760) as annual_usage_out_of_bounds,
  (select count(*) from users owner where owner.sync_growth_period_started_at is null or owner.sync_growth_period_started_at > now()) as annual_period_bounds_failures,
  (select count(*) from users owner where owner.seq not between 0 and 9007199254740991) as sequence_owner_out_of_bounds,
  (select count(*) from users owner join actual_usage actual on actual.user_id = owner.id where owner.seq < actual.maximum_record_seq) as sequence_owner_behind_records,
  (select count(*) from users owner where owner.gc_seq is null or owner.gc_seq not between 0 and 9007199254740991) as gc_sequence_out_of_bounds,
  (select count(*) from users owner where owner.gc_seq > owner.seq) as gc_sequence_above_owner,
  sequence_bounds.sequence_record_out_of_bounds,
  sequence_bounds.duplicate_record_sequence_groups
from sequence_bounds;
