-- Expand-only phase: deploy this before code that writes aggregate auth
-- counters. The legacy login_attempts table is intentionally left untouched so
-- an older function can keep running during the rollout window.
begin;

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

-- The Edge function uses the table owner through direct Postgres. PostgREST's
-- public roles get the intended zero-policy default deny.
alter table auth_rate_limit_buckets enable row level security;

-- Supabase has pg_cron; PGlite/local Postgres may not. Dynamic SQL keeps this
-- migration portable while replacing unbounded history with expiring buckets.
do $do$
begin
  if to_regclass('cron.job') is not null then
    execute $schedule$
      select cron.schedule(
        'routino-auth-rate-limit-purge',
        '30 * * * *',
        $job$delete from auth_rate_limit_buckets where expires_at < now()$job$
      )
    $schedule$;
  end if;
end
$do$;

commit;
