begin;
set local statement_timeout = '30s';
set local lock_timeout = '2s';

-- Minimal permanent identity/engagement ledger for product analytics.
-- Heavy/product data stays in users/records and can still be removed by the
-- existing 30-day retention cleanup. This table keeps only the canonical phone
-- plus compact counters/timestamps required for lifetime and return metrics.
create table if not exists public.lifetime_users (
  phone text primary key,
  first_joined_at timestamptz not null,
  last_joined_at timestamptz not null,
  registration_count integer not null default 1,
  active_days_lifetime integer not null default 0,
  last_active_day date,
  last_active_at timestamptz,
  trial_started boolean not null default false,
  current_user_id uuid unique references public.users(id) on delete set null,
  constraint lifetime_users_registration_count_positive check (registration_count >= 1),
  constraint lifetime_users_active_days_nonnegative check (active_days_lifetime >= 0),
  constraint lifetime_users_join_order check (last_joined_at >= first_joined_at)
);

-- Records when exact lifetime tracking became available. Existing live accounts
-- are backfilled below; accounts already destroyed before this migration cannot
-- be reconstructed from anonymous counters.
create table if not exists public.lifetime_user_analytics_policy (
  key text primary key,
  deployed_at timestamptz not null
);
insert into public.lifetime_user_analytics_policy (key, deployed_at)
values ('v1', clock_timestamp())
on conflict (key) do nothing;

-- Backfill every account that still exists without changing any operational row.
-- active_days/last_active_at are the existing server-authoritative counters.
insert into public.lifetime_users (
  phone,
  first_joined_at,
  last_joined_at,
  registration_count,
  active_days_lifetime,
  last_active_day,
  last_active_at,
  trial_started,
  current_user_id
)
select
  u.phone,
  u.created_at,
  u.created_at,
  1,
  greatest(u.active_days, 0),
  case
    when u.last_active_at is null then null
    else (u.last_active_at at time zone 'Asia/Tehran')::date
  end,
  u.last_active_at,
  exists (
    select 1
      from public.grants g
     where g.user_id = u.id
       and g.source = 'trial'
  ),
  u.id
from public.users u
on conflict (phone) do update set
  first_joined_at = least(lifetime_users.first_joined_at, excluded.first_joined_at),
  last_joined_at = greatest(lifetime_users.last_joined_at, excluded.last_joined_at),
  active_days_lifetime = greatest(
    lifetime_users.active_days_lifetime,
    excluded.active_days_lifetime
  ),
  last_active_day = case
    when lifetime_users.last_active_day is null then excluded.last_active_day
    when excluded.last_active_day is null then lifetime_users.last_active_day
    else greatest(lifetime_users.last_active_day, excluded.last_active_day)
  end,
  last_active_at = case
    when lifetime_users.last_active_at is null then excluded.last_active_at
    when excluded.last_active_at is null then lifetime_users.last_active_at
    else greatest(lifetime_users.last_active_at, excluded.last_active_at)
  end,
  trial_started = lifetime_users.trial_started or excluded.trial_started,
  current_user_id = excluded.current_user_id;

-- One write per account creation. Re-registering the same phone after automatic
-- cleanup increments registration_count instead of creating a second lifetime user.
create or replace function public.routino_track_lifetime_registration()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  insert into lifetime_users (
    phone,
    first_joined_at,
    last_joined_at,
    registration_count,
    active_days_lifetime,
    last_active_day,
    last_active_at,
    trial_started,
    current_user_id
  ) values (
    new.phone,
    new.created_at,
    new.created_at,
    1,
    greatest(new.active_days, 0),
    case
      when new.last_active_at is null then null
      else (new.last_active_at at time zone 'Asia/Tehran')::date
    end,
    new.last_active_at,
    false,
    new.id
  )
  on conflict (phone) do update set
    first_joined_at = least(lifetime_users.first_joined_at, excluded.first_joined_at),
    last_joined_at = greatest(lifetime_users.last_joined_at, excluded.last_joined_at),
    registration_count = lifetime_users.registration_count + 1,
    current_user_id = excluded.current_user_id;
  return new;
end
$function$;

drop trigger if exists users_lifetime_registration_after_insert on public.users;
create trigger users_lifetime_registration_after_insert
after insert on public.users
for each row execute function public.routino_track_lifetime_registration();

-- users.active_days already changes at most once per Tehran calendar day. Mirror
-- that durable event into the lifetime row. last_active_day prevents a same-day
-- re-registration from double-counting one human day across two account rows.
create or replace function public.routino_track_lifetime_activity()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  observed_day date;
begin
  if new.last_active_at is null or new.active_days <= old.active_days then
    return new;
  end if;

  observed_day := (new.last_active_at at time zone 'Asia/Tehran')::date;

  insert into lifetime_users (
    phone,
    first_joined_at,
    last_joined_at,
    registration_count,
    active_days_lifetime,
    last_active_day,
    last_active_at,
    trial_started,
    current_user_id
  ) values (
    new.phone,
    new.created_at,
    new.created_at,
    1,
    greatest(new.active_days, 0),
    observed_day,
    new.last_active_at,
    false,
    new.id
  )
  on conflict (phone) do update set
    active_days_lifetime = lifetime_users.active_days_lifetime + case
      when lifetime_users.last_active_day is null
        or lifetime_users.last_active_day < observed_day then 1
      else 0
    end,
    last_active_day = case
      when lifetime_users.last_active_day is null then observed_day
      else greatest(lifetime_users.last_active_day, observed_day)
    end,
    last_active_at = case
      when lifetime_users.last_active_at is null then new.last_active_at
      else greatest(lifetime_users.last_active_at, new.last_active_at)
    end,
    current_user_id = new.id;

  return new;
end
$function$;

drop trigger if exists users_lifetime_activity_after_update on public.users;
create trigger users_lifetime_activity_after_update
after update of active_days, last_active_at on public.users
for each row
when (new.active_days > old.active_days)
execute function public.routino_track_lifetime_activity();

-- Trial state is useful historically even after the grant row is removed by
-- automatic account cleanup. It is analytics only; this migration does not alter
-- trial eligibility/business logic.
create or replace function public.routino_track_lifetime_trial()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.source = 'trial' then
    update lifetime_users lu
       set trial_started = true
      from users u
     where u.id = new.user_id
       and lu.phone = u.phone;
  end if;
  return new;
end
$function$;

drop trigger if exists grants_lifetime_trial_after_insert on public.grants;
create trigger grants_lifetime_trial_after_insert
after insert on public.grants
for each row
when (new.source = 'trial')
execute function public.routino_track_lifetime_trial();

-- Stable aggregate entry point for the admin/SQL editor. "returning_users"
-- means observed on at least two distinct Tehran calendar days; re-registration
-- is reported separately because it means the account was recreated after purge.
create or replace function public.routino_lifetime_user_metrics(
  p_now timestamptz default clock_timestamp()
)
returns table (
  tracking_started_at timestamptz,
  lifetime_users bigint,
  current_accounts bigint,
  first_time_users_last_24h bigint,
  active_users_last_24h bigint,
  returning_users bigint,
  re_registered_users bigint,
  total_re_registrations bigint,
  trial_users bigint
)
language sql
stable
set search_path = public
as $function$
  select
    (select deployed_at
       from lifetime_user_analytics_policy
      where key = 'v1') as tracking_started_at,
    count(*)::bigint as lifetime_users,
    count(*) filter (where current_user_id is not null)::bigint as current_accounts,
    count(*) filter (
      where first_joined_at > p_now - interval '24 hours'
    )::bigint as first_time_users_last_24h,
    count(*) filter (
      where last_active_at > p_now - interval '24 hours'
    )::bigint as active_users_last_24h,
    count(*) filter (where active_days_lifetime >= 2)::bigint as returning_users,
    count(*) filter (where registration_count >= 2)::bigint as re_registered_users,
    coalesce(sum(greatest(registration_count - 1, 0)), 0)::bigint as total_re_registrations,
    count(*) filter (where trial_started)::bigint as trial_users
  from lifetime_users
$function$;

-- The Edge API uses a direct owner connection. Keep Supabase PostgREST's public
-- anon/authenticated roles default-denied, matching the rest of Routino's schema.
alter table public.lifetime_users enable row level security;
alter table public.lifetime_user_analytics_policy enable row level security;

revoke execute on function public.routino_track_lifetime_registration() from public;
revoke execute on function public.routino_track_lifetime_activity() from public;
revoke execute on function public.routino_track_lifetime_trial() from public;
revoke execute on function public.routino_lifetime_user_metrics(timestamptz) from public;

commit;
