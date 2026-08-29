-- Routino is pre-launch: device sessions, device limits and user blocking were
-- removed from the product. Authentication is a stateless 30-day signed token.
drop table if exists device_security_events;
drop table if exists devices;

alter table users drop column if exists blocked;
alter table users drop column if exists max_active_devices;
alter table users drop column if exists security_locked_at;
alter table users drop column if exists security_lock_reason;
alter table users drop column if exists device_switch_reset_at;
