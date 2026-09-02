begin;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'routino-trial-account-cleanup';

select cron.schedule(
  'routino-trial-account-cleanup',
  '37 3 * * *',
  $$begin;
set local statement_timeout = '5000ms';
set local lock_timeout = '250ms';
select * from routino_cleanup_trial_accounts(50, clock_timestamp());
commit;$$
);

commit;
