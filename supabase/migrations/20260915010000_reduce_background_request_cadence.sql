-- Reduce background maintenance wakeups without changing any maintenance logic.
-- User-facing payment callback verification remains immediate; only the
-- authoritative recovery sweep cadence changes from 5 to 10 minutes.
begin;

do $schedule$
declare
  target_job_id bigint;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;

  select jobid into target_job_id
    from cron.job
   where jobname = 'routino-payment-unverified'
   order by jobid desc
   limit 1;
  if target_job_id is null then
    raise exception 'routino-payment-unverified cron job is missing';
  end if;
  perform cron.alter_job(job_id => target_job_id, schedule => '*/10 * * * *');

  select jobid into target_job_id
    from cron.job
   where jobname = 'routino-task-month-compaction'
   order by jobid desc
   limit 1;
  if target_job_id is null then
    raise exception 'routino-task-month-compaction cron job is missing';
  end if;
  perform cron.alter_job(job_id => target_job_id, schedule => '17 */6 * * *');

  select jobid into target_job_id
    from cron.job
   where jobname = 'routino-tombstone-purge'
   order by jobid desc
   limit 1;
  if target_job_id is null then
    raise exception 'routino-tombstone-purge cron job is missing';
  end if;
  perform cron.alter_job(job_id => target_job_id, schedule => '43 4 * * *');

  select jobid into target_job_id
    from cron.job
   where jobname = 'routino-auth-rate-limit-purge'
   order by jobid desc
   limit 1;
  if target_job_id is null then
    raise exception 'routino-auth-rate-limit-purge cron job is missing';
  end if;
  perform cron.alter_job(job_id => target_job_id, schedule => '30 */3 * * *');
end
$schedule$;

commit;
