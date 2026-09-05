begin;

-- Refuse ambiguous history before installing the invariant. This migration
-- never deletes, merges, reprices or terminalises a payment row.
do $$
begin
  if exists (
    select 1
      from payments
     where user_id is not null
       and applied_at is null
       and status in ('pending', 'requesting', 'redirected', 'provider_unknown', 'verifying')
     group by user_id, plan_id, amount_toman, coalesce(discount_code, ''),
              coalesce(platform, 'web')
    having count(*) > 1
  ) then
    raise exception 'duplicate nonterminal logical payments require review before enabling checkout uniqueness';
  end if;
end
$$;

alter table payments
  add column if not exists checkout_provider text not null default 'zarinpal';

create unique index if not exists payments_nonterminal_checkout_unique
  on payments (
    user_id, plan_id, amount_toman, coalesce(discount_code, ''),
    coalesce(platform, 'web'), checkout_provider
  )
  where user_id is not null
    and applied_at is null
    and status in ('pending', 'requesting', 'redirected', 'provider_unknown', 'verifying');

commit;
