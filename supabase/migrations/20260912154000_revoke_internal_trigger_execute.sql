-- Trigger helpers are invoked by PostgreSQL triggers only. They are security
-- invoker, but direct PUBLIC EXECUTE is still unnecessary attack surface.
revoke execute on function routino_records_usage_after_insert() from public;
revoke execute on function routino_records_usage_after_update() from public;
revoke execute on function routino_records_usage_after_delete() from public;
