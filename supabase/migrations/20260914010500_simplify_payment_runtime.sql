begin;

-- A new click owns a new attempt_id. The per-user attempt key is sufficient
-- for idempotency; this larger logical-checkout index reused stale authorities.
drop index if exists payments_nonterminal_checkout_unique;

-- Already covered by grants_payment_id_unique.
drop index if exists grants_payment;

-- These fields are either derivable or never read. applied_at remains the one
-- durable completion timestamp and the exactly-once entitlement guard.
alter table payments drop constraint if exists payments_verify_attempts_nonnegative;
alter table payments drop column if exists discount_percent;
alter table payments drop column if exists offer_percent;
alter table payments drop column if exists card_number;
alter table payments drop column if exists verify_attempts;
alter table payments drop column if exists paid_at;
alter table payments drop column if exists verified_at;
alter table payments drop column if exists checkout_provider;

commit;
