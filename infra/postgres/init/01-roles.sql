-- Connection identity — Architecture §5.1.
--
-- Two roles, and the distinction is load-bearing:
--   app_migrator  owns every object and runs migrations. Never used by the app.
--   app_user      the application's connection. No BYPASSRLS, no ownership.
--
-- An owner role silently bypasses RLS unless FORCE is set on the table, which
-- is why every migration sets both. app_user cannot bypass either way.
--
-- Applied two ways, both idempotent:
--   * automatically, on first start of the local container (this directory is
--     mounted at /docker-entrypoint-initdb.d);
--   * by `pnpm db:provision`, against a server where dropping a file into the
--     entrypoint is not an option — a managed instance, or the client's own.
--
-- The passwords set here are placeholders for the local container only, which
-- listens on localhost. `db:provision` replaces them with the credentials from
-- the environment, so no real password is ever committed.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_migrator') then
    create role app_migrator login password 'app_migrator' nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login password 'app_user' nobypassrls;
  end if;
end $$;

-- Belt and braces: neither role may ever bypass row-level security, whatever
-- it was created as.
alter role app_migrator nobypassrls nosuperuser nocreatedb;
alter role app_user     nobypassrls nosuperuser nocreatedb nocreaterole;

-- Nobody creates objects ad hoc in public.
revoke create on schema public from public;

grant connect on database qabandi to app_migrator, app_user;

-- CREATE on the database, not merely on `public`: the migration runner keeps
-- its bookkeeping in a `drizzle` schema of its own, and `btree_gist` (§6.2) is
-- installed by the same role. app_user is deliberately not granted this — it
-- can create nothing, anywhere.
grant create on database qabandi to app_migrator;
grant create, usage on schema public to app_migrator;
grant usage on schema public to app_user;

-- Everything app_migrator creates from here on is usable by app_user by
-- default, so a new table never needs a follow-up grant. DELETE is granted
-- nowhere: nothing is deleted (§5.5), it is superseded, closed or deactivated.
alter default privileges for role app_migrator in schema public
  grant select, insert, update on tables to app_user;
alter default privileges for role app_migrator in schema public
  grant usage, select on sequences to app_user;
alter default privileges for role app_migrator in schema public
  grant execute on functions to app_user;

-- The queue's schema — Architecture §9.
--
-- pg-boss creates its own tables on first start, and it connects as app_user,
-- which holds no CREATE on the database. Pre-creating the schema owned by
-- app_user is the narrow grant that lets it manage its own tables without
-- giving the application role the ability to create anything else.
--
-- This is only half the fix: pg-boss also opens its install with
-- `CREATE SCHEMA IF NOT EXISTS`, and Postgres checks CREATE on the database
-- before it honours IF NOT EXISTS — so that statement is refused for app_user
-- even once this schema exists. The service therefore passes
-- `createSchema: false` (apps/service/src/queue.ts); a database provisioned
-- without this line will fail at boot with 42501, not create the schema itself.
--
-- `AUTHORIZATION` needs a superuser (or a member of the role), which is why
-- this lives in the provisioning path rather than in a migration applied by
-- app_migrator.
create schema if not exists pgboss authorization app_user;
