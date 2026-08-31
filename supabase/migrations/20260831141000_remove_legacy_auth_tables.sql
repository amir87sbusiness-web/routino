-- Contract phase. Apply only after the OTP-cookie admin flow and aggregate
-- throttles have been verified in production. No account/content/payment table
-- is touched.
begin;

do $do$
declare has_legacy_admin boolean;
begin
  if to_regclass('public.admins') is not null then
    execute 'select exists (select 1 from admins)' into has_legacy_admin;
    if has_legacy_admin then
      raise exception 'legacy admins table is not empty; review before cleanup';
    end if;
  end if;
end
$do$;

do $do$
begin
  if to_regclass('cron.job') is not null then
    execute $unschedule$
      select cron.unschedule(jobid)
        from cron.job
       where jobname = 'routino-login-attempts-purge'
    $unschedule$;
  end if;
end
$do$;

drop table if exists login_attempts;
drop table if exists admins;

commit;
