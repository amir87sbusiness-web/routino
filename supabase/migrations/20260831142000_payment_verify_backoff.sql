-- Additive only: existing payment/grant state is untouched. These fields bound
-- repeated client polling so one browser cannot turn into unlimited PSP calls.
begin;

alter table payments add column if not exists next_verify_at timestamptz;
alter table payments add column if not exists verify_attempts integer not null default 0;
alter table payments drop constraint if exists payments_verify_attempts_nonnegative;
alter table payments add constraint payments_verify_attempts_nonnegative
  check (verify_attempts >= 0);

commit;
