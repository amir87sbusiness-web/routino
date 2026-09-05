begin;
set local statement_timeout = '10s';
set local lock_timeout = '1s';

-- Financial history must survive account deletion, but it must no longer retain
-- a live FK to personal account data. Existing rows are untouched; only the FK
-- behavior and nullability change.
do $$
declare
  fk_name text;
begin
  select con.conname
    into fk_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where con.contype = 'f'
     and nsp.nspname = 'public'
     and rel.relname = 'payments'
     and con.confrelid = 'public.users'::regclass
     and array_length(con.conkey, 1) = 1
     and con.conkey[1] = (
       select attnum from pg_attribute
        where attrelid = 'public.payments'::regclass
          and attname = 'user_id'
          and not attisdropped
     )
   limit 1;

  if fk_name is not null then
    execute format('alter table public.payments drop constraint %I', fk_name);
  end if;
end
$$;

alter table public.payments alter column user_id drop not null;

alter table public.payments
  drop constraint if exists payments_user_id_users_id_fk;

alter table public.payments
  add constraint payments_user_id_users_id_fk
  foreign key (user_id) references public.users(id) on delete set null;

commit;
