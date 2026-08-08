#!/bin/sh
# Restore rehearsal — run this BEFORE you need it.
#
# A backup you have never restored is not a backup, it is a hope. This restores
# into a scratch database and prints the row counts, so "the file exists" and
# "the data is in it" stop being the same claim.
#
#   docker compose run --rm backup restore.sh                  # newest in the bucket
#   docker compose run --rm backup restore.sh routino-2026-…gz # a specific one
#   docker compose run --rm backup restore.sh <file> --into-production
#
# Without --into-production it NEVER touches the live database.
set -eu

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_USER:=routino}"
: "${POSTGRES_DB:=routino}"
: "${BACKUP_DIR:=/backup}"
SCRATCH_DB="${SCRATCH_DB:-routino_restore_check}"

log() { echo "[restore] $*"; }
psql_c() { psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres -tAc "$1"; }

if [ -n "${S3_ENDPOINT:-}" ]; then
  export AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-}"
  export AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}"
  export AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}"
fi
s3() { aws --endpoint-url "$S3_ENDPOINT" s3 "$@"; }

name="${1:-}"
into_production=0
[ "${2:-}" = "--into-production" ] && into_production=1

# No name given: take the newest object in the bucket. Deliberately the BUCKET
# and not the local directory — restoring the copy that never left the machine
# would rehearse the one path that cannot help in a real disaster.
if [ -z "$name" ]; then
  [ -n "${S3_BUCKET:-}" ] || { log "no filename given and S3_BUCKET is unset"; exit 1; }
  name=$(s3 ls "s3://$S3_BUCKET/db/" | awk '{print $4}' | sort | tail -1)
  [ -n "$name" ] || { log "the bucket has no backups — this is the alarm, not the drill"; exit 1; }
  log "newest in bucket: $name"
fi

local_file="$BACKUP_DIR/$name"
if [ ! -f "$local_file" ]; then
  log "downloading $name"
  s3 cp "s3://$S3_BUCKET/db/$name" "$local_file" >/dev/null
fi

if [ "$into_production" -eq 1 ]; then
  target="$POSTGRES_DB"
  log "RESTORING OVER THE LIVE DATABASE '$target' in 10s — Ctrl-C to abort"
  sleep 10
  psql_c "drop database if exists \"$target\" with (force)" >/dev/null
  psql_c "create database \"$target\"" >/dev/null
else
  target="$SCRATCH_DB"
  log "restoring into scratch database '$target' (production untouched)"
  psql_c "drop database if exists \"$target\" with (force)" >/dev/null
  psql_c "create database \"$target\"" >/dev/null
fi

# `--set ON_ERROR_STOP=1` is what makes this a test rather than a formality:
# without it psql reports success after skipping every statement that failed.
gunzip -c "$local_file" |
  psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$target" --set ON_ERROR_STOP=1 -q

log "restored. row counts in '$target':"
psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$target" -c "
  select 'users' as table, count(*) from users
  union all select 'entitlements', count(*) from entitlements
  union all select 'payments',     count(*) from payments
  union all select 'grants',       count(*) from grants
  union all select 'devices',      count(*) from devices
  union all select 'records',      count(*) from records
  order by 1"

if [ "$into_production" -eq 0 ]; then
  log "dropping scratch database"
  psql_c "drop database \"$target\" with (force)" >/dev/null
  log "OK — this backup restores cleanly. Numbers above should look like your real data."
fi
