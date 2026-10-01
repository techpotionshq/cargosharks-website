-- Pending SQL for the access-and-security fixes (A3). Applied in order, as
-- app_migrator, after 0048. The coordinator turns this into a numbered custom
-- migration (`pnpm db:generate:custom`) once the branches are merged.

-- --------------------------------------------------------------------------
-- 1. A permission check that knows which branch it is asking about — A2, A3
-- --------------------------------------------------------------------------
--
-- `app.has_permission(p)` answers "does this principal hold p in *any*
-- branch". That is right for the deployment-wide configuration tables it
-- guards, and wrong for the one table that decides every other permission:
-- an administrator in Dubai who is read-only in Kuwait holds
-- `admin.users.write` "somewhere", and that was enough to write a Kuwait grant.
-- FR-ID-02 says a role is held per branch; the backstop has to ask per branch.
--
-- Security definer for the same reason as `has_permission`: it reads
-- `principal_branch_roles`, whose own policy is about to be written in terms
-- of this function, and an invoker-rights read would recurse into it.

create or replace function app.has_permission_in(permission text, branch uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from principal_branch_roles pbr
      join role_permissions rp on rp.role_id = pbr.role_id
     where pbr.principal_id = app.principal_id()
       and pbr.branch_id = branch
       and pbr.is_active
       and rp.permission_key = permission
       and rp.allowed
  ) or app.is_system()
$$;

grant execute on function app.has_permission_in(text, uuid) to app_user;

-- --------------------------------------------------------------------------
-- 2. `principal_branch_roles`: reading is not writing — A3
-- --------------------------------------------------------------------------
--
-- 0004's `principal_branch_roles_scope` was one `for all` policy, so its
-- `using` doubled as the `with check`, and the first arm of that expression
-- was `principal_id = app.principal_id()`. Any principal — a coordinator, a
-- read-only clerk — could therefore insert or update a grant *naming
-- themselves*, in any branch, with any role, and only `assertCan` in the
-- web app stood in the way. The database backstop was missing on exactly the
-- table that every other backstop reads.
--
-- Split into a read policy that keeps 0004's visibility unchanged, and write
-- policies that say what granting is: holding `admin.users.write` in the
-- branch the grant is for. Both the old row (`using`) and the new row
-- (`with check`) are checked on update, so a grant cannot be moved from a
-- branch the actor administers into one they do not.

drop policy if exists principal_branch_roles_scope on principal_branch_roles;

create policy principal_branch_roles_read on principal_branch_roles for select using (
  principal_id = app.principal_id()
  or app.is_system()
  or (app.principal_type() = 'internal' and branch_id = any(app.branch_ids()))
);

create policy principal_branch_roles_insert on principal_branch_roles for insert
  with check (app.has_permission_in('admin.users.write', branch_id));

create policy principal_branch_roles_update on principal_branch_roles for update
  using      (app.has_permission_in('admin.users.write', branch_id))
  with check (app.has_permission_in('admin.users.write', branch_id));

-- --------------------------------------------------------------------------
-- 3. `principals`: the same split, plus the columns nobody edits about themselves
-- --------------------------------------------------------------------------
--
-- `principals_scope` was also `for all`, and its first arm is
-- `id = app.principal_id()` — so a principal could update its own row, every
-- column of it. That is how a time-zone preference is saved, and it was also
-- how a customer contact could set `customer_id` to another customer and read
-- their invoices on the next request, or how an agent could rewrite `type` to
-- `internal`. RLS cannot compare an old value with a new one, so the
-- self-update stays permitted by policy and the identity columns are guarded
-- by the trigger below.
--
-- Updating somebody else needs `admin.users.write` in a branch they hold (or
-- held) a role in — the per-branch reading of FR-ID-02 — or, for a portal
-- contact, `admin.users.write` and a customer the actor can see. Customer
-- records are group-shared (§5.3), so the second arm has no branch to narrow
-- by.
--
-- Inserting replaces 0022's `principals_admin_invite`, which allowed only the
-- internal arm: the system principal (`db:create-user`, the service's
-- verification worker) inserted through `principals_scope`'s `is_system()`
-- arm, and that arm goes with it.

drop policy if exists principals_scope on principals;
drop policy if exists principals_admin_invite on principals;

create policy principals_read on principals for select using (
  id = app.principal_id()
  or app.is_system()
  or (app.principal_type() = 'internal' and exists (
        select 1 from principal_branch_roles pbr
         where pbr.principal_id = principals.id
           and pbr.branch_id = any(app.branch_ids())))
  or (app.principal_type() = 'customer_contact' and customer_id = app.customer_id())
  or (app.principal_type() = 'agent_contact'    and partner_id  = app.partner_id())
);

create policy principals_insert on principals for insert with check (
  app.is_system()
  or (app.principal_type() = 'internal' and app.has_permission('admin.users.write'))
);

create policy principals_update on principals for update
  using (
    id = app.principal_id()
    or app.is_system()
    or (app.principal_type() = 'internal' and (
          exists (
            select 1 from principal_branch_roles pbr
             where pbr.principal_id = principals.id
               and app.has_permission_in('admin.users.write', pbr.branch_id))
          or (principals.type in ('customer_contact', 'agent_contact')
              and app.has_permission('admin.users.write'))))
  )
  with check (
    id = app.principal_id()
    or app.is_system()
    or (app.principal_type() = 'internal' and app.has_permission('admin.users.write'))
  );

-- The identity columns: who a principal *is*, as opposed to how they like
-- their dates. Changing any of them changes what RLS lets the principal see,
-- so none of them is self-service and all of them need an administrator.
--
-- `auth_user_id` is in the list because it is the link from a credential to
-- this row: rewriting it on somebody else's row is signing in as them.

create or replace function app.principals_guard_identity() returns trigger
  language plpgsql as $$
begin
  if app.is_system() then
    return new;
  end if;

  if new.type        is distinct from old.type
  or new.customer_id is distinct from old.customer_id
  or new.partner_id  is distinct from old.partner_id
  or new.auth_user_id is distinct from old.auth_user_id then
    if old.id = app.principal_id() then
      raise exception 'a principal cannot change its own type, customer, partner or credential'
        using errcode = '42501';
    end if;
    if not (app.principal_type() = 'internal' and app.has_permission('admin.users.write')) then
      raise exception 'changing who a principal is needs admin.users.write'
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists principals_guard_identity on principals;
create trigger principals_guard_identity
  before update on principals
  for each row execute function app.principals_guard_identity();
