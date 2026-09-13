begin;

-- Payment activation must not depend on the customer returning from the gateway.
-- The blind sweep can Verify a fresh `redirected` authority while the payer is
-- still in the bank flow, so keep it disabled. Recovery is driven by ZarinPal's
-- authoritative paid-but-unverified feed instead; callback Status=OK remains the
-- immediate path and normal Verify 100/101 is still required before any grant.
do $$
declare
  reconcile_job_id bigint;
  unverified_job_id bigint;
begin
  select jobid
    into reconcile_job_id
    from cron.job
   where jobname = 'routino-payment-reconcile'
   order by jobid desc
   limit 1;

  if reconcile_job_id is not null then
    perform cron.alter_job(
      job_id => reconcile_job_id,
      active => false
    );
  end if;

  select jobid
    into unverified_job_id
    from cron.job
   where jobname = 'routino-payment-unverified'
   order by jobid desc
   limit 1;

  if unverified_job_id is null then
    raise exception 'routino-payment-unverified cron job is missing';
  end if;

  perform cron.alter_job(
    job_id => unverified_job_id,
    schedule => '*/5 * * * *',
    active => true
  );
end
$$;

commit;
