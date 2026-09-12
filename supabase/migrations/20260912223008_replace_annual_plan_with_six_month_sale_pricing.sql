alter table public.plans
  add column if not exists compare_at_price_toman integer;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.plans'::regclass
       and conname = 'plans_compare_at_price_above_sale'
  ) then
    alter table public.plans
      add constraint plans_compare_at_price_above_sale
      check (compare_at_price_toman is null or compare_at_price_toman > price_toman);
  end if;
end
$$;

update public.plans
   set active = false
 where id = 'm12'
   and active = true;

update public.plans
   set active = true
 where id in ('m1', 'm3')
   and active = false;

insert into public.plans (
  id,
  name_fa,
  name_en,
  months,
  price_toman,
  compare_at_price_toman,
  active
)
values ('m6', 'شش‌ماهه', '6 Months', 6, 999000, null, true)
on conflict (id) do update
set name_fa = excluded.name_fa,
    name_en = excluded.name_en,
    months = excluded.months,
    price_toman = excluded.price_toman,
    compare_at_price_toman = excluded.compare_at_price_toman,
    active = excluded.active;
