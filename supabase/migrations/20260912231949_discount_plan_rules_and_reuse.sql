begin;

alter table discounts
  add column if not exists plan_rules jsonb not null default '{}'::jsonb;

alter table redemptions drop constraint if exists redemptions_code_fkey;
alter table redemptions
  add constraint redemptions_code_fkey
  foreign key (code) references discounts(code) on delete cascade;

commit;
