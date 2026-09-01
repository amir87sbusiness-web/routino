begin;

-- Expand-only rollout for live accounts: no record is rewritten and existing
-- content is grandfathered by starting annual usage at zero.
alter table users add column if not exists
  sync_growth_period_started_at timestamptz not null default now();
alter table users add column if not exists
  sync_growth_bytes bigint not null default 0;

alter table users drop constraint if exists users_sync_data_bytes_bounds;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_sync_data_bytes_nonnegative'
  ) then
    alter table users add constraint users_sync_data_bytes_nonnegative
      check (sync_data_bytes >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'users_sync_growth_bytes_bounds'
  ) then
    alter table users add constraint users_sync_growth_bytes_bounds
      check (sync_growth_bytes between 0 and 10485760);
  end if;
end
$$;

alter table records drop constraint if exists records_kind_valid;
alter table records add constraint records_kind_valid check (kind in
  ('categories','habits','habitMonths','tasks','timerSessions','journal','taskMonths'));

commit;
