-- Architecture §5.2, §5.3 — the actor settings and the functions that read them.
--
-- `withActor` stamps six transaction-local settings at the start of every
-- request. These functions are the only readers, and every RLS policy is
-- written in terms of them rather than against `current_setting` directly, so
-- a change to how the actor is carried is one file, not fifteen policies.

create schema if not exists app;
grant usage on schema app to app_user;

-- `current_setting(..., true)` returns null rather than raising when the
-- setting is absent. Absent means "no actor", which every policy treats as
-- "see nothing" — the fail-closed default.

create or replace function app.principal_id() returns uuid
  language sql stable parallel safe as $$
  select nullif(current_setting('app.principal_id', true), '')::uuid
$$;

create or replace function app.principal_type() returns text
  language sql stable parallel safe as $$
  select nullif(current_setting('app.principal_type', true), '')
$$;

-- Branch scoping — FR-ID-02. A principal holds a role per branch, so the
-- setting is a comma-separated list rather than a single id.
create or replace function app.branch_ids() returns uuid[]
  language sql stable parallel safe as $$
  select coalesce(
    string_to_array(nullif(current_setting('app.branch_ids', true), ''), ',')::uuid[],
    '{}'::uuid[])
$$;

create or replace function app.customer_id() returns uuid
  language sql stable parallel safe as $$
  select nullif(current_setting('app.customer_id', true), '')::uuid
$$;

create or replace function app.partner_id() returns uuid
  language sql stable parallel safe as $$
  select nullif(current_setting('app.partner_id', true), '')::uuid
$$;

create or replace function app.ip() returns inet
  language sql stable parallel safe as $$
  select nullif(current_setting('app.ip', true), '')::inet
$$;

-- Convenience predicates the policies read. `is_internal()` deliberately does
-- not imply "may see everything" — branch scoping still applies on top.
create or replace function app.is_internal() returns boolean
  language sql stable parallel safe as $$
  select app.principal_type() in ('internal', 'system')
$$;

create or replace function app.is_system() returns boolean
  language sql stable parallel safe as $$
  select app.principal_type() = 'system'
$$;

-- Does the principal hold a role in this branch?
create or replace function app.in_branch(target uuid) returns boolean
  language sql stable parallel safe as $$
  select target = any(app.branch_ids())
$$;

-- Permission check against the editable matrix — FR-ID-03.
--
-- Read by the write-side policies on administrative tables. Feature code also
-- checks permissions before acting; this is the backstop that holds when it
-- forgets, which is the entire premise of §5.
create or replace function app.has_permission(permission text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from principal_branch_roles pbr
      join role_permissions rp on rp.role_id = pbr.role_id
     where pbr.principal_id = app.principal_id()
       and rp.permission_key = permission
       and rp.allowed
  ) or app.is_system()
$$;

grant execute on all functions in schema app to app_user;
