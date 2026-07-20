-- Routino database setup for Supabase.
-- Generated from backend/src/db/ddl.ts (the same DDL the test suites run).
-- Idempotent (if not exists / on conflict) — safe to run more than once.
-- Apply: paste into the Supabase SQL Editor, or let scripts/apply-db-setup.mjs do it.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  seq bigint not null default 0,
  gc_seq bigint not null default 0,
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);

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
    ('categories','habits','logs','tasks','timerSessions','journal','settings'))
);
create index if not exists records_pull on records (user_id, seq);
create index if not exists records_habit on records (user_id, (data->>'habitId')) where kind = 'logs';

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  refresh_hash text not null,
  name text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists devices_user on devices (user_id);

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
  provider text,
  track_id bigint unique,
  authority text unique,
  ref_number text,
  card_number text,
  psp_result integer,
  psp_status integer,
  paid_at timestamptz,
  verified_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_user on payments (user_id);
create index if not exists payments_status on payments (status, created_at);

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
alter table payments add column if not exists provider text;
alter table payments add column if not exists authority text;
-- authority is unique per transaction (multiple NULLs allowed for numeric gateways).
create unique index if not exists payments_authority on payments (authority);

insert into plans (id, name_fa, name_en, months, price_toman) values
  ('m1',  'یک‌ماهه', '1 Month',  1,  59000),
  ('m3',  'سه‌ماهه', '3 Months', 3,  149000),
  ('m12', 'یک‌ساله', '1 Year',   12, 449000)
on conflict (id) do nothing;

-- Hourly purge of expired OTP rows (the Node backend did this with setInterval;
-- edge functions have no resident process, so the database does it itself).
-- OTP rows double as the rate-limit ledger, so they must live 24h first.
create extension if not exists pg_cron;
select cron.schedule('routino-otp-purge', '0 * * * *',
  $$delete from otp_codes where created_at < now() - interval '24 hours'$$);
