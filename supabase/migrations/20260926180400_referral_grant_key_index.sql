-- pg-delta: transaction=false

create unique index concurrently grants_idempotency_key_unique
  on grants (idempotency_key) where idempotency_key is not null;
