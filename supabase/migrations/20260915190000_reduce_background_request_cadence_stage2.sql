-- Further reduce non-user-facing maintenance wakeups without changing task/payment semantics.
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
   where jobname = 'routino-task-month-compaction'
   order by jobid desc
   limit 1;
  if target_job_id is null then
    raise exception 'routino-task-month-compaction cron job is missing';
  end if;
  perform cron.alter_job(job_id => target_job_id, schedule => '17 */12 * * *');

  select jobid into target_job_id
    from cron.job
   where jobname = 'routino-auth-rate-limit-purge'
   order by jobid desc
   limit 1;
  if target_job_id is null then
    raise exception 'routino-auth-rate-limit-purge cron job is missing';
  end if;
  perform cron.alter_job(job_id => target_job_id, schedule => '30 */6 * * *');
end
$schedule$;

commit;
