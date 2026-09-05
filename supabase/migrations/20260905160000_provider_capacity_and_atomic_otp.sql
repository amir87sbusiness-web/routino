begin;

-- Fixed-size, anonymous permits bound concurrent calls to external providers.
-- The table intentionally has no user, phone, IP, payment, or request columns.
create table if not exists provider_capacity_leases (
  kind text not null,
  lease_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (kind, lease_id)
);
create index if not exists provider_capacity_leases_expiry
  on provider_capacity_leases (kind, expires_at);

-- The API uses a direct owner connection; PostgREST must expose no permits.
alter table provider_capacity_leases enable row level security;

commit;
