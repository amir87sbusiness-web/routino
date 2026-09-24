import { writeFileSync } from "node:fs";
import { SCHEMA_SQL } from "../backend/src/db/ddl.ts";

function sliceThrough(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`DDL marker missing: ${startMarker}`);
  return source.slice(start, end).trimEnd();
}

const encode = sliceThrough(
  SCHEMA_SQL,
  "create or replace function routino_encode_record_data(",
  "create or replace function routino_decode_record_data(",
);
const push = sliceThrough(
  SCHEMA_SQL,
  "create or replace function routino_push_records(",
  "-- Cursor admission and the write share one transaction",
);
const predicate = sliceThrough(
  SCHEMA_SQL,
  "create or replace function routino_task_archive_candidate_valid(",
  "create or replace function routino_task_compaction_backlog(",
);
const expand = sliceThrough(
  SCHEMA_SQL,
  "create or replace function routino_expand_task_archive_item(",
  "-- A short v2 tuple can fall below TOAST's compression threshold",
);

const output = `-- Backward-compatible optional task categories.
-- This migration replaces functions only. It does not create tables or indexes,
-- and it never updates, backfills, deletes, or rewrites an existing user row.

${encode}

${push}

${predicate}

revoke execute on function routino_task_archive_candidate_valid(text, jsonb) from public;

${expand}

revoke execute on function routino_expand_task_archive_item(jsonb, text, jsonb) from public;
`;

writeFileSync(
  new URL("../supabase/migrations/20260924151651_task_categories.sql", import.meta.url),
  output,
);
