# Backup sidecar: pg_dump plus an S3 client, nothing else.
#
# Built on the same postgres image as the database on purpose. pg_dump refuses
# to run against a server newer than itself, so pinning both to one image is
# what stops "backups silently stopped working" the day Postgres is upgraded.
FROM postgres:17-alpine

# aws-cli comes from Alpine's own repositories rather than a vendor download
# (dl.min.io, GitHub releases), because those are the ones most likely to be
# slow or unreachable from an Iranian connection. If apk itself is slow, point
# it at a local mirror, e.g.:
#   sed -i 's|dl-cdn.alpinelinux.org|repo.iut.ac.ir|g' /etc/apk/repositories
RUN apk add --no-cache aws-cli

COPY backup.sh restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh

ENTRYPOINT ["/usr/local/bin/backup.sh"]
