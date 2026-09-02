-- READ-ONLY production precheck for Routino trial-account retention.
-- Returns aggregate counts only: no phone, UUID, username, IP or hash.
-- This file installs nothing and deletes nothing.
begin transaction read only;
set local statement_timeout = '5s';
set local lock_timeout = '250ms';

with rollout as materialized (
  select
    statement_timestamp() as evaluated_at,
    statement_timestamp() as deployment_cutoff,
    statement_timestamp() + interval '30 days' as preexisting_grace_until
), grant_facts as (
  select
    u.id,
    count(g.id)::integer as grant_count,
    count(g.id) filter (
      where g.source = 'trial'
        and g.payment_id is null
        and g.months = 0
        and g.days = 7
        and g.expires_before is null
        and g.expires_after is not null
    )::integer as valid_trial_count,
    count(g.id) filter (
      where g.source <> 'trial' or g.payment_id is not null
    )::integer as non_trial_grant_count,
    max(g.expires_after) filter (where g.source = 'trial') as trial_expires_at
  from users u
  left join grants g on g.user_id = u.id
  group by u.id
), account_facts as (
  select
    u.id,
    u.created_at,
    gf.grant_count,
    gf.valid_trial_count,
    gf.non_trial_grant_count,
    gf.trial_expires_at,
    e.user_id is not null as has_entitlement,
    e.plan_id,
    e.expires_at,
    exists (select 1 from payments p where p.user_id = u.id) as has_payment,
    exists (
      select 1 from payments p
       where p.user_id = u.id and (p.status = 'paid' or p.applied_at is not null)
    ) as has_paid_payment,
    exists (
      select 1 from payments p
       where p.user_id = u.id
         and p.applied_at is null
         and p.status not in ('paid', 'failed', 'canceled', 'verify_failed')
    ) as has_ambiguous_payment,
    exists (
      select 1 from payments p
       where p.user_id = u.id
         and p.applied_at is null
         and p.status in ('failed', 'canceled', 'verify_failed')
    ) as has_other_financial_history,
    exists (select 1 from redemptions r where r.user_id = u.id) as has_redemption,
    exists (
      select 1 from discounts d
       where d.phone = u.phone and d.used_count > 0
    ) as has_used_private_discount,
    exists (
      select 1 from discounts d
       where d.phone = u.phone
         and (
           exists (select 1 from payments p where p.discount_code = d.code)
           or exists (select 1 from redemptions r where r.code = d.code)
         )
    ) as has_referenced_private_discount
  from users u
  join grant_facts gf on gf.id = u.id
  left join entitlements e on e.user_id = u.id
), classified as (
  select
    *,
    case
      when grant_count = 0 and not has_entitlement then 'no_trial'
      when grant_count = 1
        and valid_trial_count = 1
        and has_entitlement
        and plan_id = 'trial'
        and expires_at = trial_expires_at
        then 'trial_only'
      else null
    end as structural_kind,
    case
      when grant_count = 0 and not has_entitlement
        then created_at + interval '30 days'
      when grant_count = 1
        and valid_trial_count = 1
        and has_entitlement
        and plan_id = 'trial'
        and expires_at = trial_expires_at
        then greatest(created_at + interval '30 days', expires_at)
      else null
    end as structural_deletion_at
  from account_facts
), decisions as (
  select
    classified.*,
    rollout.evaluated_at,
    greatest(
      structural_deletion_at,
      case
        when created_at < rollout.deployment_cutoff
          then rollout.preexisting_grace_until
        else '-infinity'
      end
    ) as effective_deletion_at,
    not has_payment
      and not has_redemption
      and not has_used_private_discount
      and not has_referenced_private_discount
      and non_trial_grant_count = 0
      and structural_kind is not null as eligible,
    structural_deletion_at <= rollout.evaluated_at as normal_due
  from classified cross join rollout
)
select
  count(*) filter (where eligible)::integer as eligible_total,
  count(*) filter (
    where eligible and structural_kind = 'no_trial'
  )::integer as eligible_no_trial_total,
  count(*) filter (
    where eligible and structural_kind = 'trial_only'
  )::integer as eligible_trial_only_total,
  count(*) filter (where eligible and normal_due)::integer as normal_deadline_due_total,
  count(*) filter (
    where eligible and effective_deletion_at <= evaluated_at
  )::integer as eligible_due_total,
  count(*) filter (where eligible and normal_due and structural_kind = 'no_trial')::integer
    as due_no_trial,
  count(*) filter (where eligible and normal_due and structural_kind = 'trial_only')::integer
    as due_trial_only,
  count(*) filter (
    where eligible and not normal_due and structural_kind = 'trial_only'
  )::integer as active_trial_deferred,
  count(*) filter (
    where eligible and normal_due and effective_deletion_at > evaluated_at
  )::integer as preexisting_grace_deferred,
  count(*) filter (where has_payment)::integer as protected_any_payment,
  count(*) filter (where has_paid_payment)::integer as protected_paid_payment,
  count(*) filter (where has_ambiguous_payment)::integer as protected_ambiguous_payment,
  count(*) filter (where has_other_financial_history)::integer
    as protected_other_financial_history,
  count(*) filter (where non_trial_grant_count > 0)::integer as protected_non_trial_grant,
  count(*) filter (where has_redemption)::integer as protected_used_redemption,
  count(*) filter (where has_used_private_discount)::integer as protected_used_discount,
  count(*) filter (
    where has_referenced_private_discount
  )::integer as protected_referenced_private_discount,
  count(*) filter (
    where not has_payment
      and not has_redemption
      and not has_used_private_discount
      and not has_referenced_private_discount
      and non_trial_grant_count = 0
      and structural_kind is null
  )::integer as protected_inconsistent_state,
  count(*) filter (
    where eligible and normal_due and has_payment
  )::integer as selected_with_payment,
  count(*) filter (
    where eligible and normal_due and non_trial_grant_count > 0
  )::integer as selected_with_non_trial_grant,
  count(*) filter (
    where eligible and normal_due and has_redemption
  )::integer as selected_with_used_redemption,
  count(*) filter (
    where eligible and normal_due and has_used_private_discount
  )::integer as selected_with_used_discount
  ,count(*) filter (
    where eligible and normal_due and has_referenced_private_discount
  )::integer as selected_with_referenced_private_discount
from decisions;

rollback;
