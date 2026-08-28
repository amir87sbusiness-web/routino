begin;

lock table payments in share row exclusive mode;
lock table grants in share row exclusive mode;

-- Never discard an unsettled legacy-provider payment silently. Terminal failed
-- and canceled attempts carry no recoverable money state and do not block
-- column cleanup; every other unapplied legacy state requires explicit review.
do $$
declare
  has_legacy boolean := false;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'provider'
  ) then
    execute $q$
      select exists (
        select 1 from payments
        where provider is not null and provider <> 'zarinpal'
          and applied_at is null and status not in ('failed', 'canceled')
      )
    $q$ into has_legacy;
  end if;
  if not has_legacy and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'track_id'
  ) then
    execute $q$
      select exists (
        select 1 from payments
        where track_id is not null and applied_at is null
          and status not in ('failed', 'canceled')
      )
    $q$
      into has_legacy;
  end if;
  if has_legacy then
    raise exception 'unsettled legacy-provider payments require review before ZarinPal-only cleanup';
  end if;
  if exists (
    select 1 from grants where payment_id is not null
    group by payment_id having count(*) > 1
  ) then
    raise exception 'duplicate grants.payment_id rows require review before uniqueness';
  end if;
end
$$;

alter table payments add column if not exists attempt_id uuid;
alter table payments add column if not exists authority text;
alter table payments add column if not exists request_started_at timestamptz;
alter table payments add column if not exists verify_started_at timestamptz;

update payments set attempt_id = gen_random_uuid() where attempt_id is null;
alter table payments alter column attempt_id set default gen_random_uuid();
alter table payments alter column attempt_id set not null;

drop index if exists payments_provider_ref_unique;
alter table payments drop column if exists provider;
alter table payments drop column if exists provider_ref;
alter table payments drop column if exists track_id;
alter table payments drop column if exists psp_status;

create unique index if not exists payments_user_attempt_unique
  on payments (user_id, attempt_id);
create unique index if not exists payments_authority
  on payments (authority) where authority is not null;
create unique index if not exists grants_payment_id_unique
  on grants (payment_id) where payment_id is not null;

commit;
