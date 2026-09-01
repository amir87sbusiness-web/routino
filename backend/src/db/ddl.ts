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
  sync_record_count integer not null default 0,
  sync_data_bytes bigint not null default 0,
  sync_growth_period_started_at timestamptz not null default now(),
  sync_growth_bytes bigint not null default 0,
  constraint users_sync_record_count_bounds check
    (sync_record_count between 0 and 50000),
  constraint users_sync_data_bytes_nonnegative check (sync_data_bytes >= 0),
  constraint users_sync_growth_bytes_bounds check
    (sync_growth_bytes between 0 and 10485760),
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
    ('categories','habits','habitMonths','tasks','timerSessions','journal','taskMonths'))
);
delete from records where kind = 'settings';
alter table records drop constraint if exists records_kind_valid;
alter table records add constraint records_kind_valid check (kind in
  ('categories','habits','habitMonths','tasks','timerSessions','journal','taskMonths'));
create index if not exists records_pull on records (user_id, seq);

-- Exact per-account storage accounting. Existing databases are backfilled only
-- while the trigger set is absent; normal boots see the triggers and skip the
-- aggregate scan entirely. Statement-level transition tables update each user
-- once per INSERT/UPDATE/DELETE statement, not once per record in a batch.
alter table users add column if not exists sync_record_count integer not null default 0;
alter table users add column if not exists sync_data_bytes bigint not null default 0;
alter table users add column if not exists
  sync_growth_period_started_at timestamptz not null default now();
alter table users add column if not exists sync_growth_bytes bigint not null default 0;
alter table users drop constraint if exists users_sync_data_bytes_bounds;
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname in (
       'records_sync_usage_after_insert',
       'records_sync_usage_after_update',
       'records_sync_usage_after_delete'
     ) and not tgisinternal
  ) then
    update users u
       set sync_record_count = usage.record_count,
           sync_data_bytes = usage.data_bytes
      from (
        select u0.id,
               count(r.*)::integer as record_count,
               coalesce(sum(octet_length(r.data::text)), 0)::bigint as data_bytes
          from users u0
          left join records r on r.user_id = u0.id
         group by u0.id
      ) usage
     where u.id = usage.id;
  end if;
end
$$;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_sync_record_count_bounds') then
    alter table users add constraint users_sync_record_count_bounds check
      (sync_record_count between 0 and 50000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_sync_data_bytes_nonnegative') then
    alter table users add constraint users_sync_data_bytes_nonnegative check
      (sync_data_bytes >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_sync_growth_bytes_bounds') then
    alter table users add constraint users_sync_growth_bytes_bounds check
      (sync_growth_bytes between 0 and 10485760);
  end if;
end
$$;

create or replace function routino_records_usage_after_insert()
returns trigger language plpgsql as $$
begin
  update users u
     set sync_record_count = u.sync_record_count + delta.record_count,
         sync_data_bytes = u.sync_data_bytes + delta.data_bytes
    from (
      select user_id,
             count(*)::integer as record_count,
             coalesce(sum(octet_length(data::text)), 0)::bigint as data_bytes
        from new_rows
       group by user_id
    ) delta
   where u.id = delta.user_id;
  return null;
end
$$;

create or replace function routino_records_usage_after_update()
returns trigger language plpgsql as $$
begin
  update users u
     set sync_record_count = u.sync_record_count + delta.record_count,
         sync_data_bytes = u.sync_data_bytes + delta.data_bytes
    from (
      select user_id,
             sum(record_delta)::integer as record_count,
             sum(byte_delta)::bigint as data_bytes
        from (
          select user_id, -1 as record_delta,
                 -coalesce(octet_length(data::text), 0)::bigint as byte_delta
            from old_rows
          union all
          select user_id, 1 as record_delta,
                 coalesce(octet_length(data::text), 0)::bigint as byte_delta
            from new_rows
        ) changes
       group by user_id
    ) delta
   where u.id = delta.user_id
     and (delta.record_count <> 0 or delta.data_bytes <> 0);
  return null;
end
$$;

create or replace function routino_records_usage_after_delete()
returns trigger language plpgsql as $$
begin
  update users u
     set sync_record_count = u.sync_record_count - delta.record_count,
         sync_data_bytes = u.sync_data_bytes - delta.data_bytes
    from (
      select user_id,
             count(*)::integer as record_count,
             coalesce(sum(octet_length(data::text)), 0)::bigint as data_bytes
        from old_rows
       group by user_id
    ) delta
   where u.id = delta.user_id;
  return null;
end
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'records_sync_usage_after_insert') then
    create trigger records_sync_usage_after_insert
      after insert on records
      referencing new table as new_rows
      for each statement execute function routino_records_usage_after_insert();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'records_sync_usage_after_update') then
    create trigger records_sync_usage_after_update
      after update on records
      referencing old table as old_rows new table as new_rows
      for each statement execute function routino_records_usage_after_update();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'records_sync_usage_after_delete') then
    create trigger records_sync_usage_after_delete
      after delete on records
      referencing old table as old_rows
      for each statement execute function routino_records_usage_after_delete();
  end if;
end
$$;

-- One client round trip, two server commands: the first command acquires the
-- per-owner lock; the volatile function's RETURN QUERY then reads a fresh
-- READ COMMITTED snapshot. This avoids the stale statement-snapshot race that
-- a single lock-and-read CTE would have after waiting for another device.
create or replace function routino_push_records(
  p_user_id uuid,
  p_now timestamptz,
  p_incoming jsonb
)
returns table (
  cursor bigint,
  applied bigint,
  skipped bigint,
  quota_rejected jsonb
)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
begin
  perform 1 from users u where u.id = p_user_id for update;
  if not found then
    raise exception 'unknown sync user';
  end if;

  return query
  with recursive incoming (
    kind, id, data, updated_at, original_updated_at, deleted, ord
  ) as (
    select item.value->>'kind',
           item.value->>'id',
           item.value->'data',
           (item.value->>'updatedAt')::bigint,
           (item.value->>'originalUpdatedAt')::bigint,
           (item.value->>'deleted')::boolean,
           item.ord::bigint
      from jsonb_array_elements(p_incoming) with ordinality item(value, ord)
  ),
  cascaded (
    kind, id, data, updated_at, original_updated_at, deleted, ord
  ) as (
    select 'habitMonths'::text, child.id, null::jsonb,
           parent.updated_at, parent.original_updated_at, true,
           jsonb_array_length(p_incoming)::bigint
             + row_number() over (order by child.id)
      from incoming parent
      join records child
        on child.user_id = p_user_id
       and child.kind = 'habitMonths'
       and child.deleted = false
       and child.id like parent.id || '|%'
     where parent.kind = 'habits' and parent.deleted = true
  ),
  deduped as (
    select distinct on (combined.kind, combined.id)
           combined.kind, combined.id, combined.data, combined.updated_at,
           combined.original_updated_at, combined.deleted, combined.ord
      from (
        select * from incoming
        union all
        select * from cascaded
      ) combined
     order by combined.kind, combined.id, combined.updated_at desc,
              combined.deleted desc, combined.ord
  ),
  current_state as (
    select u.sync_growth_period_started_at, u.sync_growth_bytes
      from users u where u.id = p_user_id
  ),
  effective_period as (
    select case
             when cs.sync_growth_period_started_at + interval '365 days' <= p_now
               then p_now
             else cs.sync_growth_period_started_at
           end as period_start,
           case
             when cs.sync_growth_period_started_at + interval '365 days' <= p_now
               then 0::bigint
             else cs.sync_growth_bytes
           end as base_used
      from current_state cs
  ),
  prepared as (
    select d.kind, d.id,
           final.final_data as data,
           final.final_updated_at as updated_at,
           d.original_updated_at,
           final.final_deleted as deleted,
           d.ord,
           decision.will_apply,
           greatest(
             coalesce(octet_length(final.final_data::text), 0) -
             coalesce(octet_length(existing.data::text), 0),
             0
           )::bigint as positive_growth
      from deduped d
      left join records existing
        on existing.user_id = p_user_id
       and existing.kind = d.kind
       and existing.id = d.id
      cross join lateral (
        select case
                 when d.kind = 'habitMonths'
                  and d.deleted = false
                  and existing.user_id is not null
                  and existing.deleted = false
                 then jsonb_build_object(
                   'habitId', d.data->'habitId',
                   'monthKey', d.data->'monthKey',
                   'cells', coalesce(existing.data->'cells', '{}'::jsonb) || coalesce((
                     select jsonb_object_agg(incoming_cell.key, incoming_cell.value)
                       from jsonb_each(d.data->'cells') incoming_cell
                      where coalesce(
                        (existing.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
                        -1
                      ) < (incoming_cell.value->>'updatedAt')::bigint
                   ), '{}'::jsonb)
                 )
                 else d.data
               end as final_data,
               case
                 when d.kind = 'habitMonths'
                  and d.deleted = false
                  and existing.user_id is not null
                  and existing.deleted = false
                 then greatest(existing.updated_at, d.updated_at)
                 else d.updated_at
               end as final_updated_at,
               case
                 when d.kind = 'habitMonths'
                  and d.deleted = false
                  and existing.user_id is not null
                  and existing.deleted = false
                 then false
                 else d.deleted
               end as final_deleted
      ) final
      cross join lateral (
        select case
                 when existing.user_id is null then true
                 when d.kind = 'habitMonths' then case
                   when d.deleted = true or existing.deleted = true
                     then existing.updated_at < d.updated_at
                   else exists (
                     select 1
                       from jsonb_each(d.data->'cells') incoming_cell
                      where coalesce(
                        (existing.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
                        -1
                      ) < (incoming_cell.value->>'updatedAt')::bigint
                   )
                 end
                 else existing.updated_at < d.updated_at
               end as will_apply
      ) decision
  ),
  ranked as (
    select p.*,
           10485760::bigint - ep.base_used as allowance_remaining
      from prepared p cross join effective_period ep
  ),
  positive_candidates as (
    select r.*,
           row_number() over (order by r.ord, r.kind, r.id)::bigint as budget_position
      from ranked r
     where r.will_apply and r.positive_growth > 0
  ),
  budget_walk as (
    select pc.*,
           (pc.positive_growth <= pc.allowance_remaining) as budget_accepted,
           case when pc.positive_growth <= pc.allowance_remaining
             then pc.positive_growth else 0::bigint end as accepted_growth
      from positive_candidates pc where pc.budget_position = 1
    union all
    select pc.*,
           (walk.accepted_growth + pc.positive_growth <= pc.allowance_remaining),
           case
             when walk.accepted_growth + pc.positive_growth <= pc.allowance_remaining
               then walk.accepted_growth + pc.positive_growth
             else walk.accepted_growth
           end
      from budget_walk walk
      join positive_candidates pc
        on pc.budget_position = walk.budget_position + 1
  ),
  accepted_pre as (
    select r.kind, r.id, r.data, r.updated_at, r.original_updated_at,
           r.deleted, r.ord, r.positive_growth
      from ranked r
     where r.will_apply and r.positive_growth = 0
    union all
    select walk.kind, walk.id, walk.data, walk.updated_at,
           walk.original_updated_at, walk.deleted, walk.ord, walk.positive_growth
      from budget_walk walk where walk.budget_accepted
  ),
  accepted as (
    select accepted_pre.*,
           row_number() over (
             order by accepted_pre.ord, accepted_pre.kind, accepted_pre.id
           )::bigint as position
      from accepted_pre
  ),
  budget_rejected as (
    select walk.kind, walk.id, walk.original_updated_at, walk.ord
      from budget_walk walk where not walk.budget_accepted
  ),
  sized as (
    select count(*)::bigint as total,
           coalesce(sum(accepted.positive_growth), 0)::bigint as positive_growth
      from accepted
  ),
  bump as (
    update users u
       set seq = u.seq + sized.total,
           sync_growth_period_started_at = ep.period_start,
           sync_growth_bytes = ep.base_used + sized.positive_growth
      from sized cross join effective_period ep
     where u.id = p_user_id
    returning u.seq,
              u.sync_growth_period_started_at + interval '365 days' as retry_at
  ),
  upserted as (
    insert into records (user_id, kind, id, data, updated_at, deleted, seq)
    select p_user_id, accepted.kind, accepted.id, accepted.data,
           accepted.updated_at, accepted.deleted,
           bump.seq - sized.total + accepted.position
      from accepted cross join sized cross join bump
    on conflict (user_id, kind, id) do update
      set data = case
            when excluded.kind = 'habitMonths'
             and excluded.deleted = false
             and records.deleted = false
            then jsonb_build_object(
              'habitId', excluded.data->'habitId',
              'monthKey', excluded.data->'monthKey',
              'cells', coalesce(records.data->'cells', '{}'::jsonb) || coalesce((
                select jsonb_object_agg(incoming_cell.key, incoming_cell.value)
                  from jsonb_each(excluded.data->'cells') incoming_cell
                 where coalesce(
                   (records.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
                   -1
                 ) < (incoming_cell.value->>'updatedAt')::bigint
              ), '{}'::jsonb)
            )
            else excluded.data
          end,
          updated_at = case
            when excluded.kind = 'habitMonths'
             and excluded.deleted = false
             and records.deleted = false
            then greatest(records.updated_at, excluded.updated_at)
            else excluded.updated_at
          end,
          deleted = case
            when excluded.kind = 'habitMonths'
             and excluded.deleted = false
             and records.deleted = false
            then false
            else excluded.deleted
          end,
          seq = excluded.seq
      where case
        when excluded.kind = 'habitMonths' then case
          when excluded.deleted = true or records.deleted = true
            then records.updated_at < excluded.updated_at
          else exists (
            select 1
              from jsonb_each(excluded.data->'cells') incoming_cell
             where coalesce(
               (records.data->'cells'->incoming_cell.key->>'updatedAt')::bigint,
               -1
             ) < (incoming_cell.value->>'updatedAt')::bigint
          )
        end
        else records.updated_at < excluded.updated_at
      end
    returning 1
  )
  select bump.seq,
         (select count(*)::bigint from upserted),
         (select count(*)::bigint from prepared where not prepared.will_apply),
         coalesce((
           select jsonb_agg(
             jsonb_build_object(
               'kind', rejected.kind,
               'id', rejected.id,
               'updatedAt', rejected.original_updated_at,
               'code', 'account_quota_exceeded',
               'retryAt', floor(extract(epoch from bump.retry_at) * 1000)::bigint
             ) order by rejected.ord, rejected.kind, rejected.id
           )
             from budget_rejected rejected
         ), '[]'::jsonb)
    from bump;
end
$function$;

revoke execute on function routino_push_records(uuid, timestamptz, jsonb) from public;

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

create table if not exists auth_rate_limit_buckets (
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_start),
  constraint auth_rate_limit_buckets_count_positive check (count >= 1)
);
create index if not exists auth_rate_limit_buckets_expiry
  on auth_rate_limit_buckets (expires_at);

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
  next_verify_at timestamptz,
  verify_attempts integer not null default 0
    constraint payments_verify_attempts_nonnegative check (verify_attempts >= 0),
  paid_at timestamptz,
  verified_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table payments add column if not exists attempt_id uuid;
alter table payments add column if not exists request_started_at timestamptz;
alter table payments add column if not exists verify_started_at timestamptz;
alter table payments add column if not exists next_verify_at timestamptz;
alter table payments add column if not exists verify_attempts integer not null default 0;
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
