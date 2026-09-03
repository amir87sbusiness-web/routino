-- Constant-size per-account activity counters. Activity is recorded by the
-- existing authenticated sync exchange, so the client makes no extra request.
alter table public.users
  add column if not exists active_days integer not null default 0,
  add column if not exists last_active_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'users_active_days_nonnegative'
       and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_active_days_nonnegative check (active_days >= 0);
  end if;
end
$$;
