-- READ-ONLY precheck for 20260911120000_lifetime_user_analytics.sql.
-- Run this first. It changes nothing.

select
  current_database() as database_name,
  now() as checked_at,
  to_regclass('public.users') is not null as users_table_exists,
  to_regclass('public.grants') is not null as grants_table_exists,
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'users'
       and column_name = 'active_days'
  ) as users_active_days_exists,
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'users'
       and column_name = 'last_active_at'
  ) as users_last_active_at_exists;

select
  count(*)::bigint as current_accounts,
  count(distinct phone)::bigint as distinct_current_phones,
  count(*) filter (where active_days >= 2)::bigint as currently_known_returning_users,
  count(*) filter (where last_active_at is not null)::bigint as accounts_with_activity
from public.users;

select
  count(*)::bigint as trial_grants,
  count(distinct user_id)::bigint as users_with_trial_grant
from public.grants
where source = 'trial';

select key, deployed_at, preexisting_grace_until
from public.account_retention_policy
where key = 'trial_cleanup_v1';
