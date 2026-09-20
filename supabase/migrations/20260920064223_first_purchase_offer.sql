alter table plans add column offer_enabled boolean not null default false;
alter table plans add column offer_first_kind text not null default 'percent';
alter table plans add column offer_first_value integer not null default 0;
alter table plans add column offer_second_kind text not null default 'percent';
alter table plans add column offer_second_value integer not null default 0;

alter table plans add constraint plans_offer_first_rule check (
  (offer_first_kind = 'percent' and offer_first_value between 0 and 100) or
  (offer_first_kind = 'fixed' and offer_first_value between 0 and 1000000000)
);
alter table plans add constraint plans_offer_second_rule check (
  (offer_second_kind = 'percent' and offer_second_value between 0 and 100) or
  (offer_second_kind = 'fixed' and offer_second_value between 0 and 1000000000)
);
