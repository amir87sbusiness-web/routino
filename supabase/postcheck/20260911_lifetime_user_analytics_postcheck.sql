-- READ-ONLY postcheck for 20260911120000_lifetime_user_analytics.sql.
-- Run immediately after the migration. It changes nothing.

select * from public.routino_lifetime_user_metrics(clock_timestamp());

-- Every live operational account must map to exactly one lifetime row.
select count(*)::bigint as live_accounts_missing_from_lifetime
from public.users u
left join public.lifetime_users lu
  on lu.phone = u.phone and lu.current_user_id = u.id
where lu.phone is null;

-- A lifetime row may be archived (current_user_id NULL), but a non-NULL pointer
-- must resolve to the same phone in users.
select count(*)::bigint as bad_current_user_links
from public.lifetime_users lu
join public.users u on u.id = lu.current_user_id
where u.phone <> lu.phone;

select
  count(*)::bigint as lifetime_rows,
  count(*) filter (where current_user_id is not null)::bigint as linked_current_rows,
  count(*) filter (where current_user_id is null)::bigint as archived_rows,
  count(*) filter (where active_days_lifetime >= 2)::bigint as returning_users,
  count(*) filter (where registration_count >= 2)::bigint as re_registered_users
from public.lifetime_users;

select
  tgname as trigger_name,
  tgrelid::regclass::text as table_name,
  tgenabled as enabled
from pg_trigger
where not tgisinternal
  and tgname in (
    'users_lifetime_registration_after_insert',
    'users_lifetime_activity_after_update',
    'grants_lifetime_trial_after_insert'
  )
order by tgname;
