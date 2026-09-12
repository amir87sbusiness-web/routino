-- Routino payment integrity hardening.
--
-- This migration turns invariants already enforced by the payment service into
-- database invariants as well. It is deliberately fail-closed: if historical
-- data is inconsistent, deployment stops instead of silently deleting or
-- rewriting financial history.

-- 1) Preflight all relationships before installing FKs / NOT NULL.
do $$
begin
  if exists (
    select 1
      from grants g
      left join payments p on p.id = g.payment_id
     where g.payment_id is not null and p.id is null
  ) then
    raise exception 'orphan grants.payment_id rows must be resolved before payment hardening';
  end if;

  if exists (
    select 1
      from redemptions r
      left join payments p on p.id = r.payment_id
     where r.payment_id is null or p.id is null
  ) then
    raise exception 'redemptions must reference an existing payment before payment hardening';
  end if;

  if exists (
    select 1
      from payments p
      left join discounts d on d.code = p.discount_code
     where p.discount_code is not null and d.code is null
  ) then
    raise exception 'payments.discount_code contains an unknown discount';
  end if;

  if exists (
    select 1 from grants
     where (source = 'payment' and payment_id is null)
        or (source <> 'payment' and payment_id is not null)
  ) then
    raise exception 'grants source/payment_id invariant is violated';
  end if;

  if exists (
    select 1 from payments
     where months <= 0
        or amount_toman < 0
        or amount_rial <> amount_toman::bigint * 10
        or (discount_percent is not null and discount_percent not between 0 and 100)
        or (offer_percent is not null and offer_percent not between 0 and 100)
        or (platform is not null and platform not in ('web','android','ios'))
        or checkout_provider <> 'zarinpal'
        or status not in (
          'pending','requesting','redirected','provider_unknown','verifying',
          'paid','failed','canceled','verify_failed','operational_error','manual_review'
        )
        or (applied_at is not null and status <> 'paid')
        or (
          status = 'paid' and (
            applied_at is null or paid_at is null or verified_at is null
            or (
              amount_toman > 0 and (
                authority is null
                or ref_number is null
                or btrim(ref_number) = ''
                or psp_result not in (100,101)
              )
            )
          )
        )
  ) then
    raise exception 'payments contains rows that violate the hardened financial model';
  end if;
end
$$;

-- 2) Financial-history relationships. A referenced discount/payment cannot be
-- deleted out from under an audit row; disable codes instead of deleting them.
alter table payments
  add constraint payments_discount_code_fkey
  foreign key (discount_code) references discounts(code) on delete restrict;

alter table grants
  add constraint grants_payment_id_fkey
  foreign key (payment_id) references payments(id) on delete restrict;

alter table redemptions alter column payment_id set not null;
alter table redemptions
  add constraint redemptions_payment_id_fkey
  foreign key (payment_id) references payments(id) on delete restrict;

create unique index redemptions_payment_id_unique on redemptions(payment_id);

-- 3) Cross-column invariants that are cheap enough to make structural.
alter table grants
  add constraint grants_payment_source_valid check (
    (source = 'payment' and payment_id is not null)
    or (source <> 'payment' and payment_id is null)
  );

alter table payments
  add constraint payments_months_positive check (months > 0),
  add constraint payments_amounts_consistent check (
    amount_toman >= 0 and amount_rial = amount_toman::bigint * 10
  ),
  add constraint payments_discount_percent_valid check (
    discount_percent is null or discount_percent between 0 and 100
  ),
  add constraint payments_offer_percent_valid check (
    offer_percent is null or offer_percent between 0 and 100
  ),
  add constraint payments_platform_valid check (
    platform is null or platform in ('web','android','ios')
  ),
  add constraint payments_provider_valid check (checkout_provider = 'zarinpal'),
  add constraint payments_status_valid check (
    status in (
      'pending','requesting','redirected','provider_unknown','verifying',
      'paid','failed','canceled','verify_failed','operational_error','manual_review'
    )
  ),
  add constraint payments_applied_is_paid check (applied_at is null or status = 'paid'),
  add constraint payments_paid_shape_valid check (
    status <> 'paid' or (
      applied_at is not null
      and paid_at is not null
      and verified_at is not null
      and (
        amount_toman = 0
        or (
          authority is not null
          and ref_number is not null
          and btrim(ref_number) <> ''
          and psp_result in (100,101)
        )
      )
    )
  );

alter table plans
  add constraint plans_months_positive check (months > 0),
  add constraint plans_price_nonnegative check (price_toman >= 0);

alter table discounts
  add constraint discounts_percent_valid check (percent between 0 and 100),
  add constraint discounts_used_count_nonnegative check (used_count >= 0),
  add constraint discounts_max_uses_nonnegative check (max_uses is null or max_uses >= 0);

-- 4) One redemption must describe the same payment/user/code. This trigger is
-- an integrity guard, not business logic: the application still owns checkout
-- and pricing. It prevents manual/buggy writes from corrupting the ledger.
create or replace function routino_validate_redemption_payment()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid;
  v_discount_code text;
  v_status text;
  v_applied_at timestamptz;
begin
  select p.user_id, p.discount_code, p.status, p.applied_at
    into v_user_id, v_discount_code, v_status, v_applied_at
    from payments p
   where p.id = new.payment_id;

  if not found then
    raise exception 'redemption references unknown payment';
  end if;
  if v_user_id is distinct from new.user_id then
    raise exception 'redemption user does not match payment user';
  end if;
  if v_discount_code is distinct from new.code then
    raise exception 'redemption code does not match payment discount';
  end if;
  if v_status <> 'paid' or v_applied_at is null then
    raise exception 'redemption requires an applied paid payment';
  end if;
  return new;
end
$function$;

revoke execute on function routino_validate_redemption_payment() from public;
drop trigger if exists redemptions_validate_payment on redemptions;
create trigger redemptions_validate_payment
  before insert or update of code, user_id, payment_id on redemptions
  for each row execute function routino_validate_redemption_payment();

-- 5) Make discount bookkeeping atomic with the grant/entitlement/payment
-- transaction. applyPaid inserts the payment grant before marking the payment
-- paid, so this is an AFTER grant trigger and performs only the ledger/count
-- portion. The application's redeemDiscount remains idempotent and becomes a
-- harmless no-op after this trigger has inserted the row.
create or replace function routino_redeem_payment_discount_from_grant()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_payment_user_id uuid;
  v_payment_months integer;
  v_discount_code text;
  v_inserted_code text;
begin
  if new.source <> 'payment' then
    return new;
  end if;

  select p.user_id, p.months, p.discount_code
    into v_payment_user_id, v_payment_months, v_discount_code
    from payments p
   where p.id = new.payment_id
   for key share;

  if not found then
    raise exception 'payment grant references unknown payment';
  end if;
  if v_payment_user_id is distinct from new.user_id then
    raise exception 'payment grant user does not match payment';
  end if;
  if v_payment_months is distinct from new.months or new.days <> 0 then
    raise exception 'payment grant duration does not match payment';
  end if;

  if v_discount_code is null then
    return new;
  end if;

  -- The payment row is not marked paid until later in the same applyPaid
  -- transaction, so insert directly here after validating the payment/grant
  -- relationship. The FK/unique constraints provide the remaining guarantees.
  insert into redemptions(code, user_id, payment_id, created_at)
  values (v_discount_code, new.user_id, new.payment_id, new.created_at)
  on conflict do nothing
  returning code into v_inserted_code;

  if v_inserted_code is not null then
    update discounts
       set used_count = case
         when max_uses is null then used_count + 1
         else least(used_count + 1, max_uses)
       end
     where code = v_inserted_code;
  end if;
  return new;
end
$function$;

revoke execute on function routino_redeem_payment_discount_from_grant() from public;
drop trigger if exists grants_redeem_payment_discount on grants;
create trigger grants_redeem_payment_discount
  after insert on grants
  for each row execute function routino_redeem_payment_discount_from_grant();

-- The redemption validation trigger normally requires the payment to already be
-- paid. The grant trigger is the one intentional earlier insertion, and it has
-- independently validated user/payment/code/duration above. Skip recursive
-- validation only for that trigger path.
create or replace function routino_validate_redemption_payment()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid;
  v_discount_code text;
  v_status text;
  v_applied_at timestamptz;
begin
  select p.user_id, p.discount_code, p.status, p.applied_at
    into v_user_id, v_discount_code, v_status, v_applied_at
    from payments p
   where p.id = new.payment_id;

  if not found then raise exception 'redemption references unknown payment'; end if;
  if v_user_id is distinct from new.user_id then
    raise exception 'redemption user does not match payment user';
  end if;
  if v_discount_code is distinct from new.code then
    raise exception 'redemption code does not match payment discount';
  end if;
  if pg_trigger_depth() <= 1 and (v_status <> 'paid' or v_applied_at is null) then
    raise exception 'redemption requires an applied paid payment';
  end if;
  return new;
end
$function$;

revoke execute on function routino_validate_redemption_payment() from public;

-- 6) Align indexes with the current state machine. Legacy operational/manual
-- states remain recoverable, but must never block a brand-new logical checkout.
drop index if exists payments_nonterminal_checkout_unique;
create unique index payments_nonterminal_checkout_unique
  on payments (
    user_id, plan_id, amount_toman, coalesce(discount_code, ''),
    coalesce(platform, 'web'), checkout_provider
  )
  where user_id is not null
    and applied_at is null
    and status in ('pending','requesting','redirected','provider_unknown','verifying');

drop index if exists payments_reconcile_due;
create index payments_reconcile_due
  on payments (created_at, next_verify_at)
  where applied_at is null
    and authority is not null
    and status in (
      'pending','requesting','redirected','provider_unknown','verifying',
      'operational_error','manual_review'
    );

-- 7) Remove columns from the superseded payment diagnostic model. Current
-- provider state is represented by psp_result/status/verify timestamps.
alter table payments
  drop column if exists last_error_class,
  drop column if exists last_http_status,
  drop column if exists last_provider_code,
  drop column if exists last_error_at,
  drop column if exists manual_review_at,
  drop column if exists discount_redemption_pending;
