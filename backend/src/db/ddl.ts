/**
 * Schema DDL, shared by the dev bootstrap and the test harness so the two can
 * never drift apart.
 *
 * `if not exists` throughout, so it is safe to run on every boot.
 *
 * No pgcrypto: `gen_random_uuid()` has been in Postgres core since v13, and both
 * PGlite and the postgres:17 image are well past that.
 *
 * For the real deployment, `drizzle-kit generate` produces versioned migrations
 * from `schema.ts`; this exists so a developer can go from `git clone` to a
 * running server with nothing installed.
 */
export const SCHEMA_SQL = `
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  username text,
  password_hash text,
  seq bigint not null default 0,
  gc_seq bigint not null default 0,
  created_at timestamptz not null default now()
);
-- Pre-launch cleanup: these fields and tables are no longer part of the product.
drop table if exists device_security_events;
drop table if exists devices;
alter table users drop column if exists blocked;
alter table users drop column if exists max_active_devices;
alter table users drop column if exists security_locked_at;
alter table users drop column if exists security_lock_reason;
alter table users drop column if exists device_switch_reset_at;

create table if not exists records (
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb,
  updated_at bigint not null,
  deleted boolean not null default false,
  seq bigint not null,
  primary key (user_id, kind, id),
  constraint records_kind_valid check (kind in
    ('categories','habits','habitMonths','tasks','timerSessions','journal'))
);
delete from records where kind = 'settings';
alter table records drop constraint if exists records_kind_valid;
alter table records add constraint records_kind_valid check (kind in
  ('categories','habits','habitMonths','tasks','timerSessions','journal'));
create index if not exists records_pull on records (user_id, seq);

create table if not exists otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists otp_phone_recent on otp_codes (phone, created_at);
create index if not exists otp_ip_recent on otp_codes (ip, created_at);
-- The global daily circuit breaker counts the whole table by created_at with no
-- phone or ip to narrow it, on every single code request. It is also what the
-- 24h purge scans.
create index if not exists otp_recent on otp_codes (created_at);

create table if not exists login_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text,
  identifier text not null,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_identifier on login_attempts (identifier, created_at);
create index if not exists login_attempts_ip on login_attempts (ip, created_at);

create table if not exists plans (
  id text primary key,
  name_fa text not null,
  name_en text not null,
  months integer not null,
  price_toman integer not null,
  active boolean not null default true
);

create table if not exists discounts (
  code text primary key,
  percent integer not null,
  phone text,
  active boolean not null default true,
  max_uses integer,
  used_count integer not null default 0,
  expires_at timestamptz
);

create table if not exists redemptions (
  code text not null references discounts(code),
  user_id uuid not null references users(id) on delete cascade,
  payment_id uuid,
  created_at timestamptz not null default now(),
  primary key (code, user_id)
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  plan_id text not null,
  months integer not null,
  amount_toman integer not null,
  amount_rial bigint not null,
  discount_code text,
  discount_percent integer,
  offer_percent integer,
  status text not null default 'pending',
  platform text,
  attempt_id uuid not null default gen_random_uuid(),
  authority text unique,
  ref_number text,
  card_number text,
  psp_result integer,
  request_started_at timestamptz,
  verify_started_at timestamptz,
  paid_at timestamptz,
  verified_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table payments add column if not exists attempt_id uuid;
alter table payments add column if not exists request_started_at timestamptz;
alter table payments add column if not exists verify_started_at timestamptz;
update payments set attempt_id = gen_random_uuid() where attempt_id is null;
alter table payments alter column attempt_id set default gen_random_uuid();
alter table payments alter column attempt_id set not null;
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
end
$$;
drop index if exists payments_provider_ref_unique;
alter table payments drop column if exists provider;
alter table payments drop column if exists provider_ref;
alter table payments drop column if exists track_id;
alter table payments drop column if exists psp_status;
create index if not exists payments_user on payments (user_id);
create index if not exists payments_status on payments (status, created_at);
create unique index if not exists payments_user_attempt_unique
  on payments (user_id, attempt_id);
-- A limited discount code counts the checkouts currently in flight against it
-- (slotsTaken in services/pricing.ts), on the checkout path. Partial, because
-- most payments carry no code at all.
create index if not exists payments_discount on payments (discount_code) where discount_code is not null;

create table if not exists grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  months integer not null default 0,
  days integer not null default 0,
  source text not null,
  payment_id uuid,
  note text,
  expires_before timestamptz,
  expires_after timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists grants_user on grants (user_id);
-- Refuse to install the invariant over ambiguous history. Production operators
-- must inspect duplicate payment grants; startup/migration never deletes money
-- audit rows or guesses which entitlement extension was intended.
do $$
begin
  if exists (
    select 1 from grants
     where payment_id is not null
     group by payment_id
    having count(*) > 1
  ) then
    raise exception 'duplicate grants.payment_id rows must be resolved before enabling uniqueness';
  end if;
end
$$;
create unique index if not exists grants_payment_id_unique
  on grants (payment_id) where payment_id is not null;
-- settleOpenPayments asks "which paid payments have no grant behind them" on the
-- boot path, which is a NOT EXISTS against this column. Partial: admin gifts and
-- trials carry no payment_id and would only bloat it.
create index if not exists grants_payment on grants (payment_id) where payment_id is not null;

create table if not exists entitlements (
  user_id uuid primary key references users(id) on delete cascade,
  plan_id text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  rating integer not null,
  section text,
  comment text,
  at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists admins (
  user_id uuid primary key references users(id) on delete cascade,
  role text not null default 'admin'
);

-- Idempotent upgrades for databases created before a column existed. "create
-- table if not exists" silently skips existing tables, so new columns must be
-- added explicitly here.
alter table payments add column if not exists platform text;
alter table payments add column if not exists authority text;
-- ZarinPal authority is unique per transaction (multiple NULLs are allowed).
create unique index if not exists payments_authority on payments (authority);

-- Password + username sign-in (added after the users table already existed in
-- production). Both nullable: OTP-only accounts keep working untouched.
alter table users add column if not exists username text;
alter table users add column if not exists password_hash text;
-- username unique, but many NULLs allowed (unset accounts). Stored lowercased.
create unique index if not exists users_username on users (username);

-- records_habit indexed (data->>'habitId') for a query that was never written:
-- the habit-delete cascade matches the month id prefix (habitId|YYYY-MM), see
-- childMonthIds in services/sync.ts. An unused index is not free; dropped rather
-- than left "just in case". Re-add it WITH the query that uses it if that changes.
drop index if exists records_habit;
`;

/** Must match `src/lib/presets.ts` PLANS on the client, or the price shown and
 * the price charged diverge. */
export const SEED_PLANS_SQL = `
insert into plans (id, name_fa, name_en, months, price_toman) values
  ('m1',  'یک‌ماهه', '1 Month',  1,  59000),
  ('m3',  'سه‌ماهه', '3 Months', 3,  149000),
  ('m12', 'یک‌ساله', '1 Year',   12, 449000)
on conflict (id) do nothing;
`;

/** A dev-only discount code mirroring the one the client used to bundle. */
export const SEED_DISCOUNTS_SQL = `
insert into discounts (code, percent, active) values ('ROUTINO20', 20, true)
on conflict (code) do nothing;
`;
