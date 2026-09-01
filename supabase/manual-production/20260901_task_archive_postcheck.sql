-- Read-only, secret-safe postcheck. Every returned count is zero for a healthy
-- archive deployment. No private payload is selected as an output column.
with archives as (
  select archive.user_id,
         archive.id as archive_id,
         archive.data,
         archive.updated_at,
         archive.deleted
    from records archive
   where archive.kind = 'taskMonths'
), archive_shapes as (
  select archive.*,
         jsonb_typeof(archive.data) = 'object' as object_data,
         case when jsonb_typeof(archive.data) = 'object'
              then jsonb_typeof(archive.data->'items') = 'array'
              else false end as array_items,
         case when jsonb_typeof(archive.data) = 'object'
               and jsonb_typeof(archive.data->'items') = 'array'
              then jsonb_array_length(archive.data->'items') end as item_count
    from archives archive
), raw_items as (
  select archive.user_id,
         archive.archive_id,
         archive.data as archive_data,
         archive.updated_at as archive_updated_at,
         item.ordinality,
         item.value as item
    from archive_shapes archive
    cross join lateral jsonb_array_elements(
      case when archive.array_items then archive.data->'items' else '[]'::jsonb end
    ) with ordinality item(value, ordinality)
), shaped_items as (
  select raw.*,
         jsonb_typeof(raw.item) = 'array' as array_tuple,
         case when jsonb_typeof(raw.item) = 'array'
              then jsonb_array_length(raw.item) end as tuple_length
    from raw_items raw
), parsed_items as (
  select shaped.*,
         case when shaped.array_tuple and shaped.tuple_length = 3
                   and jsonb_typeof(shaped.item->0) = 'string'
              then shaped.item->>0 end as task_id,
         case when shaped.array_tuple and shaped.tuple_length = 3
                   and jsonb_typeof(shaped.item->1) = 'number'
                   and shaped.item->>1 ~ '^[0-9]+$'
              then (shaped.item->>1)::numeric end as updated_numeric,
         case when shaped.array_tuple and shaped.tuple_length = 3
                   and jsonb_typeof(shaped.item->2) = 'object'
              then shaped.item->2 end as task_data
    from shaped_items shaped
), bounded_items as (
  select parsed.*,
         case
           when parsed.updated_numeric between 0 and 9007199254740991
           then parsed.updated_numeric::bigint
         end as task_updated_at
    from parsed_items parsed
), valid_items as (
  select parsed.user_id,
         parsed.archive_id,
         parsed.archive_data,
         parsed.archive_updated_at,
         parsed.task_id,
         parsed.task_updated_at,
         parsed.task_data
    from bounded_items parsed
   where parsed.task_id is not null
     and parsed.task_updated_at is not null
     and parsed.task_data is not null
     and routino_task_archive_candidate_valid(parsed.task_id, parsed.task_data)
), archive_calculated as (
  select archive.user_id,
         archive.archive_id,
         count(item.task_id)::integer as valid_item_count,
         md5(string_agg(
           item.task_id || E'\n' || item.task_updated_at::text || E'\n'
           || item.task_data::text,
           E'\n' order by item.task_id
         )) as calculated_checksum,
         md5(string_agg(item.task_id, E'\n' order by item.task_id)) as id_checksum,
         max(item.task_updated_at) as maximum_updated_at,
         coalesce(sum(octet_length(jsonb_build_object(
           'kind', 'tasks',
           'id', item.task_id,
           'data', item.task_data,
           'updatedAt', item.task_updated_at,
           'deleted', false
         )::text)), 0)::bigint as expanded_bytes
    from archive_shapes archive
    left join valid_items item
      on item.user_id = archive.user_id and item.archive_id = archive.archive_id
   group by archive.user_id, archive.archive_id
), duplicate_archive_ids as (
  select item.user_id, item.task_id
    from valid_items item
   group by item.user_id, item.task_id
  having count(*) > 1
), actual_usage as (
  select owner.id as user_id,
         count(record.*)::integer as record_count,
         coalesce(sum(octet_length(record.data::text)), 0)::bigint as data_bytes
    from users owner
    left join records record on record.user_id = owner.id
   group by owner.id
)
select
  (select count(*) from archive_shapes archive
    where archive.data->'v' is distinct from '1'::jsonb) as unknown_archive_versions,
  (select count(*) from archive_shapes archive
    where archive.deleted
       or archive.object_data is not true
       or archive.array_items is not true
       or archive.data - array['v','monthKey','count','checksum','items'] <> '{}'::jsonb
       or jsonb_typeof(archive.data->'monthKey') is distinct from 'string'
       or coalesce(archive.data->>'monthKey', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
       or jsonb_typeof(archive.data->'count') is distinct from 'number'
       or coalesce(archive.data->>'count', '') !~ '^[0-9]+$'
       or jsonb_typeof(archive.data->'checksum') is distinct from 'string'
       or coalesce(archive.data->>'checksum', '') !~ '^[a-f0-9]{32}$'
  ) as malformed_archive_rows,
  (select count(*) from parsed_items item
    where not item.array_tuple
       or item.tuple_length is distinct from 3
       or item.task_id is null
       or item.updated_numeric is null
       or item.updated_numeric not between 0 and 9007199254740991
       or item.task_data is null
       or not coalesce(routino_task_archive_candidate_valid(item.task_id, item.task_data), false)
  ) as malformed_archive_tuples,
  (select count(*) from duplicate_archive_ids) as duplicate_archived_id_groups,
  (select count(*)
     from archive_shapes archive
     join archive_calculated calculated using (user_id, archive_id)
    where case
            when coalesce(archive.data->>'count', '') ~ '^[0-9]+$'
            then (archive.data->>'count')::numeric
          end is distinct from archive.item_count::numeric
       or archive.item_count is distinct from calculated.valid_item_count
  ) as archive_count_mismatches,
  (select count(*)
     from archive_shapes archive
     join archive_calculated calculated using (user_id, archive_id)
    where archive.data->>'checksum' is distinct from calculated.calculated_checksum
  ) as archive_checksum_mismatches,
  (select count(*)
     from archive_shapes archive
     join archive_calculated calculated using (user_id, archive_id)
    where archive.archive_id is distinct from
          archive.data->>'monthKey' || '|' || calculated.id_checksum
  ) as archive_identity_mismatches,
  (select count(*)
     from archive_shapes archive
     join archive_calculated calculated using (user_id, archive_id)
    where archive.updated_at is distinct from calculated.maximum_updated_at
  ) as archive_updated_at_mismatches,
  (select count(*)
     from archive_calculated calculated
    where calculated.expanded_bytes > 98304
  ) as oversized_expanded_archives,
  (select count(*)
     from valid_items archived
     join records ordinary
       on ordinary.user_id = archived.user_id
      and ordinary.kind = 'tasks'
      and ordinary.id = archived.task_id
    where ordinary.updated_at < archived.task_updated_at
       or (
         ordinary.updated_at = archived.task_updated_at
         and ordinary.deleted = false
         and ordinary.data is distinct from archived.task_data
       )
  ) as ordinary_not_newer_archive_relationships,
  (select count(*)
     from users owner join actual_usage actual on actual.user_id = owner.id
    where owner.sync_record_count is distinct from actual.record_count
  ) as lifetime_record_counter_mismatches,
  (select count(*)
     from users owner join actual_usage actual on actual.user_id = owner.id
    where owner.sync_data_bytes is distinct from actual.data_bytes
  ) as lifetime_byte_counter_mismatches,
  (select count(*) from users owner
    where owner.sync_record_count not between 0 and 50000
  ) as lifetime_record_counter_out_of_bounds,
  (select count(*) from users owner
    where owner.sync_data_bytes < 0
  ) as lifetime_byte_counter_out_of_bounds,
  (select count(*) from users owner
    where owner.sync_growth_bytes not between 0 and 10485760
  ) as annual_usage_out_of_bounds,
  (select count(*) from users owner
    where owner.sync_growth_period_started_at is null
       or owner.sync_growth_period_started_at > now()
  ) as annual_period_bounds_failures;
