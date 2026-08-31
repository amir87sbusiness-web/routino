-- Contract phase. Apply only after the OTP-cookie admin flow and aggregate
-- throttles have been verified in production. No account/content/payment table
-- is touched.
begin;

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

commit;
