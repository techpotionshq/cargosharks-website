-- Inviting a colleague — FR-ID-07, §5.3.
--
-- `principals_scope` (0004) is a single `for all` policy, and a `for all`
-- policy with no separate `with check` uses its `using` expression as the
-- check. That expression admits an internal principal only when a
-- `principal_branch_roles` row already links them to a branch the actor works
-- in:
--
--   exists (select 1 from principal_branch_roles pbr
--            where pbr.principal_id = principals.id
--              and pbr.branch_id = any (app.branch_ids()))
--
-- Correct for reading. Impossible for inserting. A principal being created has
-- no grant yet — the grant is written immediately afterwards, in the same
-- transaction, and it cannot be written first because it references the row
-- that does not exist. So the check refused every insert, and inviting a user
-- through the administration screen raised 42501 for every administrator, on
-- every attempt, since the policy was written.
--
-- It went unseen because the path that actually created people avoided it:
-- `db:create-user` runs as the system principal, and `app.is_system()` is the
-- first branch of the same expression. Day-one accounts worked, the demo data
-- worked, and the screen for inviting the second person did not.
--
-- The narrow fix is an insert policy that says what inviting *is*: an internal
-- principal who holds `admin.users.write` creating a person. Reading and
-- updating stay exactly as they were — `principals_scope` still governs both,
-- so an administrator still cannot see or amend somebody outside their own
-- branches, and the grant written a moment later is what brings the new row
-- inside that scope.

create policy principals_admin_invite on principals
  for insert
  with check (
    app.principal_type() = 'internal'
    and app.has_permission('admin.users.write')
  );
