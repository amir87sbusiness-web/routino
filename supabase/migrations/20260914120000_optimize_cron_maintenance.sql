-- Reduce maintenance wakeups to match their lifecycle windows, and retain
-- successful pg_cron history for 48 hours while keeping failures for 14 days.
-- This migration only replaces schedules; it does not execute maintenance.
do $schedule$
begin
  if to_regclass('cron.job') is not null then
    execute $sql$
      select cron.unschedule(jobid)
        from cron.job
       where jobname = 'routino-task-month-compaction'
    $sql$;
    execute $sql$
      select cron.schedule(
        'routino-task-month-compaction',
        '17 * * * *',
        $job$begin;
set local statement_timeout = '45000ms';
set local lock_timeout = '1000ms';
select * from routino_run_task_month_compaction(now(), 1000);
commit;$job$
      )
    $sql$;

    execute $sql$
      select cron.unschedule(jobid)
        from cron.job
       where jobname = 'routino-tombstone-purge'
    $sql$;
    execute $sql$
      select cron.schedule(
        'routino-tombstone-purge',
        '43 */6 * * *',
        $job$begin;
set local statement_timeout = '45000ms';
set local lock_timeout = '1000ms';
select * from routino_purge_tombstones(now(), 2000);
commit;$job$
      )
    $sql$;

    execute $sql$
      select cron.unschedule(jobid)
        from cron.job
       where jobname = 'routino-trial-account-cleanup'
    $sql$;
    execute $sql$
      select cron.schedule(
        'routino-trial-account-cleanup',
        '37 3 * * *',
        $job$begin;
set local statement_timeout = '5000ms';
set local lock_timeout = '250ms';
select * from routino_cleanup_trial_accounts(50, clock_timestamp());
commit;$job$
      )
    $sql$;

    execute $sql$
      select cron.unschedule(jobid)
        from cron.job
       where jobname = 'routino-cron-history-purge'
          or (command ilike '%delete%' and command ilike '%cron.job_run_details%')
    $sql$;
    execute $sql$
      select cron.schedule(
        'routino-cron-history-purge',
        '19 4 * * *',
        $job$delete from cron.job_run_details
               where (status = 'succeeded' and end_time < now() - interval '48 hours')
                  or (status is distinct from 'succeeded' and end_time < now() - interval '14 days')$job$
      )
    $sql$;
  end if;
end
$schedule$;
