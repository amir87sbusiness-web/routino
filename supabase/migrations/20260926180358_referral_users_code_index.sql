-- pg-delta: transaction=false

create unique index concurrently users_referral_code_unique
  on users (referral_code) where referral_code is not null;
