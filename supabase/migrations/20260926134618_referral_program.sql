begin;
set local statement_timeout = '10s';
set local lock_timeout = '1s';

alter table users add column if not exists referral_code text;
alter table grants add column if not exists idempotency_key text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'users_referral_code_format'
       and conrelid = 'public.users'::regclass
  ) then
    alter table users add constraint users_referral_code_format
      check (referral_code is null or referral_code ~ '^[A-Z]{6}$');
  end if;
end
$$;
create table if not exists referral_program_policy (
  key text primary key,
  started_at timestamptz not null,
  constraint referral_program_policy_singleton check (key = 'referral_v1')
);
insert into referral_program_policy (key, started_at)
values ('referral_v1', clock_timestamp())
on conflict (key) do nothing;

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid references users(id) on delete set null,
  invitee_id uuid references users(id) on delete set null,
  claimed_code text not null,
  claimed_at timestamptz not null default now(),
  successful_payment_id uuid references payments(id),
  successful_at timestamptz,
  constraint referrals_claimed_code_format check (claimed_code ~ '^[A-Z]{6}$'),
  constraint referrals_success_paired check
    ((successful_payment_id is null) = (successful_at is null)),
  constraint referrals_orphan_only_after_success check
    (invitee_id is not null or successful_at is not null)
);
create unique index if not exists referrals_invitee_unique on referrals (invitee_id);
create index if not exists referrals_inviter on referrals (inviter_id);
create unique index if not exists referrals_successful_payment_unique
  on referrals (successful_payment_id) where successful_payment_id is not null;
create index if not exists referrals_successful_inviter
  on referrals (inviter_id) where successful_at is not null and inviter_id is not null;

create or replace function public.routino_prepare_referrals_for_user_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  delete from public.referrals
   where invitee_id = old.id
     and successful_at is null;
  return old;
end
$function$;
revoke execute on function public.routino_prepare_referrals_for_user_delete()
  from public, anon, authenticated;
drop trigger if exists users_prepare_referrals_before_delete on public.users;
create trigger users_prepare_referrals_before_delete
before delete on public.users
for each row execute function public.routino_prepare_referrals_for_user_delete();

alter table referral_program_policy enable row level security;
alter table referrals enable row level security;
revoke all on table public.referral_program_policy, public.referrals
  from public, anon, authenticated;

commit;
