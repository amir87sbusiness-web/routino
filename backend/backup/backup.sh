#!/bin/sh
# Periodic database backup, uploaded OFF the machine.
#
# The whole point is the upload. A dump sitting in a volume on the same VM as
# the database is not a backup — the most likely way to lose the database is to
# lose the VM, and that takes the dump with it. This script therefore treats a
# missing S3 configuration as a loud, repeated warning rather than a default.
#
# Rehearse restores with restore.sh. An untested backup is decoration.
set -eu

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_USER:=routino}"
: "${POSTGRES_DB:=routino}"
: "${BACKUP_DIR:=/backup}"
: "${BACKUP_INTERVAL_SECONDS:=86400}"
: "${BACKUP_KEEP_DAYS:=30}"

log() { echo "[backup] $(date -u +%FT%TZ) $*"; }

remote=0
if [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_BUCKET:-}" ]; then
  remote=1
  # Read by aws-cli from the environment; never written to disk or logged.
  export AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:?S3_ACCESS_KEY is required when S3_ENDPOINT is set}"
  export AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:?S3_SECRET_KEY is required when S3_ENDPOINT is set}"
  export AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}"
fi

s3() { aws --endpoint-url "$S3_ENDPOINT" s3 "$@"; }

run_once() {
  stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
  name="routino-$stamp.sql.gz"
  path="$BACKUP_DIR/$name"

  # Dump to a temp file and check the exit code BEFORE compressing.
  # `pg_dump | gzip` reports gzip's status, not pg_dump's, so a dump that died
  # halfway still produces a small, perfectly valid .gz that uploads without
  # complaint and restores to nothing. That failure is invisible until the day
  # it matters, which makes it the one worth spending two extra lines on.
  if ! pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" "$POSTGRES_DB" >"$path.tmp"; then
    log "ERROR pg_dump failed — no backup written this cycle"
    rm -f "$path.tmp"
    return 1
  fi
  gzip -c "$path.tmp" >"$path"
  rm -f "$path.tmp"
  log "dumped $name ($(wc -c <"$path") bytes)"

  if [ "$remote" -eq 1 ]; then
    if s3 cp "$path" "s3://$S3_BUCKET/db/$name" >/dev/null; then
      log "uploaded to s3://$S3_BUCKET/db/$name"
    else
      # Keep the local copy: it is now the only one that exists.
      log "ERROR upload failed — the only copy of $name is on THIS machine"
      return 1
    fi
  else
    log "WARNING S3_ENDPOINT/S3_BUCKET unset — this dump never leaves the machine."
    log "WARNING losing this VM loses the database and every backup with it."
  fi

  # Prune local copies. Remote retention is deliberately left to a bucket
  # lifecycle rule: a compromised or buggy backup container must not be able to
  # delete the off-box history it just wrote.
  find "$BACKUP_DIR" -name 'routino-*.sql.gz' -mtime "+$BACKUP_KEEP_DAYS" -delete
}

# Back up immediately, then on the interval. Sleeping first (as this used to)
# means a container that restarts daily — for a deploy, a crash loop, a host
# reboot — never reaches its first dump at all.
while true; do
  run_once || log "cycle failed; retrying in ${BACKUP_INTERVAL_SECONDS}s"
  sleep "$BACKUP_INTERVAL_SECONDS"
done
