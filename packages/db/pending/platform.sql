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

drop policy if exists principal_branch_roles_read on principal_branch_roles;
create policy principal_branch_roles_read on principal_branch_roles for select using (
  principal_id = app.principal_id()
  or app.is_system()
  or (app.principal_type() = 'internal' and branch_id = any(app.branch_ids()))
);

drop policy if exists principal_branch_roles_insert on principal_branch_roles;
create policy principal_branch_roles_insert on principal_branch_roles for insert
  with check (app.has_permission_in('admin.users.write', branch_id));

drop policy if exists principal_branch_roles_update on principal_branch_roles;
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

drop policy if exists principals_read on principals;
create policy principals_read on principals for select using (
  id = app.principal_id()
  or app.is_system()
  or (app.principal_type() = 'internal' and exists (
        select 1 from principal_branch_roles pbr
         where pbr.principal_id = principals.id
           and pbr.branch_id = any(app.branch_ids())))
  or (app.principal_type() = 'customer_contact' and customer_id = app.customer_id())
  or (app.principal_type() = 'agent_contact'    and partner_id  = app.partner_id())
  -- New (A7): staff see the portal and agent logins of the companies they
  -- trade with. Customer and partner records are group-shared (§5.3), and a
  -- portal login with no branch role was otherwise invisible to everyone
  -- inside the company — so the customer page could not say who has access.
  or (app.principal_type() = 'internal' and principals.type in ('customer_contact', 'agent_contact'))
);

drop policy if exists principals_insert on principals;
create policy principals_insert on principals for insert with check (
  app.is_system()
  or (app.principal_type() = 'internal' and app.has_permission('admin.users.write'))
);

drop policy if exists principals_update on principals;
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

-- --------------------------------------------------------------------------
-- 4. API keys and webhook endpoints: written by their administrators only — A4
-- --------------------------------------------------------------------------
--
-- Both had one `for all` policy whose `using` admitted any internal principal
-- for a row with `branch_id is null` or in one of their branches — so the
-- check on write was the same, and a coordinator could insert a webhook
-- endpoint with no branch and receive every branch's events, which is the
-- deployment-wide case `webhook-delivery.ts` serves. The web app now asks for
-- `admin.api_keys.write` in the row's branch, or in every branch for a null
-- one; these say the same thing where it holds when the app forgets.

create or replace function app.has_permission_everywhere(permission text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_system() or (
    exists (select 1 from branches where is_active)
    and not exists (
      select 1 from branches b
       where b.is_active
         and not app.has_permission_in(permission, b.id))
  )
$$;

grant execute on function app.has_permission_everywhere(text) to app_user;

drop policy if exists webhook_endpoints_scope on webhook_endpoints;

drop policy if exists webhook_endpoints_read on webhook_endpoints;
create policy webhook_endpoints_read on webhook_endpoints for select using (
  case app.principal_type()
    when 'internal'         then branch_id is null or branch_id = any(app.branch_ids())
    when 'system'           then true
    when 'customer_contact' then customer_id = app.customer_id()
    else false
  end
);

drop policy if exists webhook_endpoints_insert on webhook_endpoints;
create policy webhook_endpoints_insert on webhook_endpoints for insert with check (
  case when branch_id is null
       then app.has_permission_everywhere('admin.api_keys.write')
       else app.has_permission_in('admin.api_keys.write', branch_id)
  end
);

drop policy if exists webhook_endpoints_update on webhook_endpoints;
create policy webhook_endpoints_update on webhook_endpoints for update
  using (
    case when branch_id is null
         then app.has_permission_everywhere('admin.api_keys.write')
         else app.has_permission_in('admin.api_keys.write', branch_id)
    end
  )
  with check (
    case when branch_id is null
         then app.has_permission_everywhere('admin.api_keys.write')
         else app.has_permission_in('admin.api_keys.write', branch_id)
    end
  );

drop policy if exists api_keys_scope on api_keys;

drop policy if exists api_keys_read on api_keys;
create policy api_keys_read on api_keys for select using (
  case app.principal_type()
    when 'internal'         then branch_id is null or branch_id = any(app.branch_ids())
    when 'system'           then true
    when 'customer_contact' then customer_id = app.customer_id()
    else false
  end
);

drop policy if exists api_keys_insert on api_keys;
create policy api_keys_insert on api_keys for insert with check (
  case when branch_id is null
       then app.has_permission_everywhere('admin.api_keys.write')
       else app.has_permission_in('admin.api_keys.write', branch_id)
  end
);

drop policy if exists api_keys_update on api_keys;
create policy api_keys_update on api_keys for update
  using (
    case when branch_id is null
         then app.has_permission_everywhere('admin.api_keys.write')
         else app.has_permission_in('admin.api_keys.write', branch_id)
    end
  )
  with check (
    case when branch_id is null
         then app.has_permission_everywhere('admin.api_keys.write')
         else app.has_permission_in('admin.api_keys.write', branch_id)
    end
  );

-- --------------------------------------------------------------------------
-- 5. Why an endpoint is off: a code, not an English sentence — U1
-- --------------------------------------------------------------------------
--
-- The settings page now translates `switched_off` and
-- `no_delivery_since:<day>`. Rows written before that carry the English
-- sentence; rewritten here so an Arabic page does not keep showing them.

update webhook_endpoints
   set disabled_reason = 'switched_off'
 where disabled_reason = 'Switched off by an administrator';

update webhook_endpoints
   set disabled_reason = 'no_delivery_since:' || substring(disabled_reason from '(\d{4}-\d{2}-\d{2})')
 where disabled_reason ~ '^Nothing delivered since \d{4}-\d{2}-\d{2}$';
