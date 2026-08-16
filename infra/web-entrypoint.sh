#!/bin/sh
#
# Container entrypoint for the web image.
#
# Migrations are opt-in rather than automatic. The runner connects as
# app_migrator, which owns every object and can drop a policy (§5.1) — that is
# not a role the web container should hold a connection string for on an
# ordinary restart, and a platform that restarts a container to move it between
# hosts would be applying migrations as a side effect of scheduling.
#
# So the deployment that is meant to migrate says so:
#
#   RUN_MIGRATIONS=true
#   MIGRATION_DATABASE_URL=postgres://app_migrator:...@host/qabandi
#
# and every other deployment leaves both unset and starts with no credentials
# capable of altering the schema.
#
# Migrations are forward-only and the runner takes drizzle's own lock, so two
# containers starting at once is safe; the second finds nothing to do.

set -e

if [ "${RUN_MIGRATIONS}" = "true" ] || [ "${RUN_MIGRATIONS}" = "1" ]; then
  echo "[entrypoint] applying migrations"
  node /app/db/migrate.mjs
fi

# `exec` so the server becomes PID 1 and receives Coolify's SIGTERM directly.
# Without it the shell holds PID 1, ignores the signal, and every deploy waits
# out the ten-second kill timeout.
exec "$@"
