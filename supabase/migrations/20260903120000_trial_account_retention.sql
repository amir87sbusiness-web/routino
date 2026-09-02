begin;
set local statement_timeout = '10s';
set local lock_timeout = '1s';

create table if not exists anonymous_counters (
  key text primary key,
  value bigint not null default 0,
  constraint anonymous_counters_value_nonnegative check (value >= 0)
);
insert into anonymous_counters (key, value)
select 'trial_starts', count(*)::bigint from grants where source = 'trial'
on conflict (key) do nothing;

create table if not exists account_retention_policy (
  key text primary key,
  deployed_at timestamptz not null,
  preexisting_grace_until timestamptz not null,
  constraint account_retention_policy_window_valid check
    (preexisting_grace_until >= deployed_at)
);
with boundary as materialized (
  select clock_timestamp() as deployed_at
)
insert into account_retention_policy (key, deployed_at, preexisting_grace_until)
select 'trial_cleanup_v1', deployed_at, deployed_at + interval '30 days'
  from boundary
on conflict (key) do update
  set deployed_at = excluded.deployed_at,
      preexisting_grace_until = excluded.preexisting_grace_until
where account_retention_policy.deployed_at = '-infinity';

create index if not exists users_created_at on users (created_at, id);
create index if not exists redemptions_user on redemptions (user_id);
create index if not exists feedback_user on feedback (user_id) where user_id is not null;
create index if not exists discounts_phone on discounts (phone) where phone is not null;

create or replace function routino_account_deletion_at(p_user_id uuid)
returns timestamptz
language sql
stable
set search_path = public
as $function$
  with account as (
    select id, phone, created_at
      from users
     where id = p_user_id
  ), grant_stats as (
    select
      count(g.id)::integer as grant_count,
      count(g.id) filter (
        where g.source = 'trial'
          and g.payment_id is null
          and g.months = 0
          and g.days = 7
          and g.expires_before is null
          and g.expires_after is not null
      )::integer as valid_trial_count,
      max(g.expires_after) filter (where g.source = 'trial') as trial_expires_at
    from account a
    left join grants g on g.user_id = a.id
  ), state as (
    select
      a.id,
      a.phone,
      a.created_at,
      gs.grant_count,
      gs.valid_trial_count,
      gs.trial_expires_at,
      e.plan_id,
      e.expires_at,
      e.user_id is not null as has_entitlement,
      rp.deployed_at,
      rp.preexisting_grace_until,
      exists (select 1 from payments p where p.user_id = a.id) as has_payment,
      exists (select 1 from redemptions r where r.user_id = a.id) as has_redemption,
      exists (
        select 1 from discounts d
         where d.phone = a.phone
           and (
             d.used_count > 0
             or exists (select 1 from payments p where p.discount_code = d.code)
             or exists (select 1 from redemptions r where r.code = d.code)
           )
      ) as has_private_discount_history
    from account a
    cross join grant_stats gs
    cross join account_retention_policy rp
    left join entitlements e on e.user_id = a.id
    where rp.key = 'trial_cleanup_v1'
  )
  select case
    when has_payment or has_redemption or has_private_discount_history then null
    when grant_count = 0 and not has_entitlement
      then greatest(
        created_at + interval '30 days',
        case when created_at < deployed_at then preexisting_grace_until else '-infinity' end
      )
    when grant_count = 1
      and valid_trial_count = 1
      and has_entitlement
      and plan_id = 'trial'
      and expires_at = trial_expires_at
      then greatest(
        created_at + interval '30 days',
        expires_at,
        case when created_at < deployed_at then preexisting_grace_until else '-infinity' end
      )
    else null
  end
  from state
$function$;

create or replace function routino_cleanup_trial_accounts(
  p_limit integer default 100,
  p_now timestamptz default clock_timestamp(),
  p_canary_user_id uuid default null
)
returns table (deleted_count integer)
language plpgsql
set search_path = public
set lock_timeout = '250ms'
set statement_timeout = '5s'
as $function$
declare
  candidate record;
  feedback_ids uuid[];
  otp_ids uuid[];
  discount_codes text[];
  removed integer := 0;
  affected integer := 0;
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception 'cleanup limit must be between 1 and 500';
  end if;

  for candidate in
    select u.id, u.phone
      from users u
     where u.created_at <= p_now - interval '30 days'
       and (p_canary_user_id is null or u.id = p_canary_user_id)
       and routino_account_deletion_at(u.id) <= p_now
     order by u.created_at, u.id
     for update of u skip locked
     limit p_limit
  loop
    select coalesce(array_agg(f.id), array[]::uuid[])
      into feedback_ids from feedback f where f.user_id = candidate.id;
    select coalesce(array_agg(o.id), array[]::uuid[])
      into otp_ids from otp_codes o where o.phone = candidate.phone;
    select coalesce(array_agg(d.code), array[]::text[])
      into discount_codes from discounts d
     where d.phone = candidate.phone
       and d.used_count = 0
       and not exists (select 1 from payments p where p.discount_code = d.code)
       and not exists (select 1 from redemptions r where r.code = d.code);

    delete from users u
     where u.id = candidate.id
       and routino_account_deletion_at(u.id) <= p_now
       and not exists (select 1 from payments p where p.user_id = u.id)
       and not exists (select 1 from redemptions r where r.user_id = u.id);
    get diagnostics affected = row_count;
    if affected = 1 then
      delete from feedback where id = any(feedback_ids);
      delete from otp_codes where id = any(otp_ids);
      delete from discounts
       where code = any(discount_codes)
         and used_count = 0
         and not exists (select 1 from payments p where p.discount_code = discounts.code)
         and not exists (select 1 from redemptions r where r.code = discounts.code);
      removed := removed + 1;
    end if;
  end loop;

  return query select removed;
end
$function$;

revoke execute on function routino_account_deletion_at(uuid) from public;
revoke execute on function routino_cleanup_trial_accounts(integer, timestamptz, uuid) from public;

alter table anonymous_counters enable row level security;
alter table account_retention_policy enable row level security;

commit;
