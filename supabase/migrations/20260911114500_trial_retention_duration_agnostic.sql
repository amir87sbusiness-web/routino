begin;
set local statement_timeout = '10s';
set local lock_timeout = '1s';

-- Trial retention should depend on the grant source/shape, not on a hardcoded
-- trial length. This keeps legacy seven-day trials and new three-day trials
-- equally eligible without rewriting any existing entitlement or grant rows.
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

revoke execute on function routino_account_deletion_at(uuid) from public;

commit;
