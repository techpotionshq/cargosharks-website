-- Two holes in the §5 backstop, found by writing the negative matrix that
-- `packages/db/test/rls-matrix.test.ts` now enforces.
--
-- Both share a shape worth naming: the *application* layer was tightened and
-- the *database* layer was not. §5's whole premise is that the database is the
-- backstop that holds when feature code forgets — a backstop that is weaker
-- than the code in front of it is decoration.

-- --------------------------------------------------------------------------
-- 1. `branches` was writable by every principal, portal users included
-- --------------------------------------------------------------------------
--
-- 0004 created:
--
--     create policy branches_scope on branches using (true);
--
-- with a comment promising that "writing them is gated by the write policy
-- below". No such policy was ever written.
--
-- A policy with no `for` clause is `for all`, and one with no `with check`
-- reuses its `using` expression for the check. So `using (true)` granted
-- INSERT and UPDATE on branches to *every* principal type that reaches the
-- database — a customer contact in the portal, an agent contact in the partner
-- view — and `app_user` holds INSERT and UPDATE on the table by default
-- privilege.
--
-- What that exposed is exactly what `seed.ts` says makes a branch different
-- from reference data: its base currency, its working calendar and its
-- **statutory invoice series**. The seed comment records that branch editing
-- was moved off `admin.reference.write` onto its own permission precisely so
-- that "anyone who could add a port" could not "renumber the statutory invoice
-- sequence". That reasoning was applied to `can()` in the interface and never
-- reached the policy.
--
-- Read stays open: a customer or agent contact needs the branch's legal name
-- and letterhead for the documents they receive, which is what 0004 intended.
-- Writing now requires the same permission the interface already demands.

drop policy if exists branches_scope on branches;

create policy branches_read on branches
  for select using (true);

create policy branches_write on branches
  for all
  using      (app.has_permission('admin.branches.write'))
  with check (app.has_permission('admin.branches.write'));

-- --------------------------------------------------------------------------
-- 2. `app.has_permission()` honoured revoked grants
-- --------------------------------------------------------------------------
--
-- 0005 added `principal_branch_roles.is_active` so that a grant could be taken
-- away (FR-ID-08), and its comment states that revocation "takes effect on the
-- principal's next request, because session resolution re-reads this rather
-- than trusting a claim baked into a token".
--
-- Session resolution does re-read it. `app.has_permission()` — the database
-- backstop every write-side policy on every administrative table is written
-- in terms of — did not. It joined `principal_branch_roles` without filtering
-- the flag, so a revoked administrator still satisfied
-- `admin.reference.write`, `admin.audit.read` and `admin.branches.write` at
-- the policy layer.
--
-- The consequence was narrow but real: the layer that is supposed to hold when
-- the application forgets was, for revoked grants, strictly weaker than the
-- application. Anything reaching the database with that principal's settings
-- stamped — a queued job, an API key path, a bug — kept the revoked authority.
--
-- The index added by 0005 (`principal_branch_roles_active_idx`, partial on
-- `is_active`) is the one this now uses.

create or replace function app.has_permission(permission text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from principal_branch_roles pbr
      join role_permissions rp on rp.role_id = pbr.role_id
     where pbr.principal_id = app.principal_id()
       and pbr.is_active
       and rp.permission_key = permission
       and rp.allowed
  ) or app.is_system()
$$;

grant execute on function app.has_permission(text) to app_user;
