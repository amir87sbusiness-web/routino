begin;

lock table users in share row exclusive mode;
lock table records in share row exclusive mode;

alter table users add column if not exists sync_record_count integer not null default 0;
alter table users add column if not exists sync_data_bytes bigint not null default 0;

-- One exact backfill for existing accounts. Normal sync never performs this
-- aggregate: the statement-level triggers below maintain the two deltas.
update users u
   set sync_record_count = usage.record_count,
       sync_data_bytes = usage.data_bytes
  from (
    select u0.id,
           count(r.*)::integer as record_count,
           coalesce(sum(octet_length(r.data::text)), 0)::bigint as data_bytes
      from users u0
      left join records r on r.user_id = u0.id
     group by u0.id
  ) usage
 where u.id = usage.id;

-- Do not silently strand a pre-existing account. The migration rolls back and
-- leaves all data intact so an operator can inspect exceptional usage first.
do $$
begin
  if exists (
    select 1 from users
     where sync_record_count > 50000
        or sync_data_bytes > 134217728
  ) then
    raise exception 'existing account exceeds sync storage budget and requires review';
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_sync_record_count_bounds') then
    alter table users add constraint users_sync_record_count_bounds check
      (sync_record_count between 0 and 50000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_sync_data_bytes_bounds') then
    alter table users add constraint users_sync_data_bytes_bounds check
      (sync_data_bytes between 0 and 134217728);
  end if;
end
$$;

create or replace function routino_records_usage_after_insert()
returns trigger language plpgsql as $$
begin
  update users u
     set sync_record_count = u.sync_record_count + delta.record_count,
         sync_data_bytes = u.sync_data_bytes + delta.data_bytes
    from (
      select user_id,
             count(*)::integer as record_count,
             coalesce(sum(octet_length(data::text)), 0)::bigint as data_bytes
        from new_rows
       group by user_id
    ) delta
   where u.id = delta.user_id;
  return null;
end
$$;

create or replace function routino_records_usage_after_update()
returns trigger language plpgsql as $$
begin
  update users u
     set sync_record_count = u.sync_record_count + delta.record_count,
         sync_data_bytes = u.sync_data_bytes + delta.data_bytes
    from (
      select user_id,
             sum(record_delta)::integer as record_count,
             sum(byte_delta)::bigint as data_bytes
        from (
          select user_id, -1 as record_delta,
                 -coalesce(octet_length(data::text), 0)::bigint as byte_delta
            from old_rows
          union all
          select user_id, 1 as record_delta,
                 coalesce(octet_length(data::text), 0)::bigint as byte_delta
            from new_rows
        ) changes
       group by user_id
    ) delta
   where u.id = delta.user_id
     and (delta.record_count <> 0 or delta.data_bytes <> 0);
  return null;
end
$$;

create or replace function routino_records_usage_after_delete()
returns trigger language plpgsql as $$
begin
  update users u
     set sync_record_count = u.sync_record_count - delta.record_count,
         sync_data_bytes = u.sync_data_bytes - delta.data_bytes
    from (
      select user_id,
             count(*)::integer as record_count,
             coalesce(sum(octet_length(data::text)), 0)::bigint as data_bytes
        from old_rows
       group by user_id
    ) delta
   where u.id = delta.user_id;
  return null;
end
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'records_sync_usage_after_insert') then
    create trigger records_sync_usage_after_insert
      after insert on records
      referencing new table as new_rows
      for each statement execute function routino_records_usage_after_insert();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'records_sync_usage_after_update') then
    create trigger records_sync_usage_after_update
      after update on records
      referencing old table as old_rows new table as new_rows
      for each statement execute function routino_records_usage_after_update();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'records_sync_usage_after_delete') then
    create trigger records_sync_usage_after_delete
      after delete on records
      referencing old table as old_rows
      for each statement execute function routino_records_usage_after_delete();
  end if;
end
$$;

commit;
