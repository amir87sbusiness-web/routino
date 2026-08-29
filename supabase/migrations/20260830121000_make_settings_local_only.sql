-- Preferences are device-local. Remove legacy cloud copies and reject future
-- settings rows at the database boundary.
delete from records where kind = 'settings';

alter table records drop constraint if exists records_kind_valid;
alter table records add constraint records_kind_valid check (kind in
  ('categories','habits','logs','tasks','timerSessions','journal'));
