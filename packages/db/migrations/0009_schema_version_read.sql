-- Let the application read its own schema version.
--
-- `app_user` could not see `drizzle.__drizzle_migrations`. That is the correct
-- default — the migrator owns its bookkeeping and the application has no
-- business writing it — but it made `/api/health` report a *permission* error
-- as `database: unreachable`, which sent a real outage after the wrong cause
-- for an hour.
--
-- The migration count is the one thing that distinguishes "the code is newer
-- than the database" from every other kind of failure, and that turned out to
-- be exactly the fault in play: a redeploy answered `relation "support_grants"
-- does not exist` because `pnpm db:migrate` had not been run against the
-- deployment.
--
-- Read only, on one table of migration names and timestamps. Nothing here is
-- business data and nothing here becomes writable: `app_user` still cannot
-- create, alter or insert in this schema, so the boundary that matters — the
-- application cannot rewrite its own migration history — is untouched.

grant usage on schema drizzle to app_user;
grant select on drizzle.__drizzle_migrations to app_user;

-- Future migrations create their bookkeeping rows in the same table, so no
-- default-privilege rule is needed: the table itself is what is being granted,
-- and Drizzle does not replace it.
