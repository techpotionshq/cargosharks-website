-- Support access — the vendor side of a support contract, enforced here.
--
-- The problem this solves is narrow and completely unavoidable once the
-- platform is sold with support attached: a customer writes "the invoice total
-- is wrong on KWI-1042", and nobody on our side can look. `app_user` holds
-- `nobypassrls` and owns nothing (§5.1), and the policies in `0004` admit four
-- principal types, none of which is us. That is correct security and it leaves
-- exactly one gap, which is that whatever gets improvised under pressure — a
-- shared administrator login, a `psql` session as `app_migrator`, a superuser
-- query — is the thing that ends up in the incident report.
--
-- So the access is designed rather than improvised, and the design is:
--
--   granted     the operator writes the `support_grants` row, not us
--   time-boxed  `expires_at` is checked in the policy, not by a cleanup job
--   revocable   `revoked_at` takes effect on the next statement
--   read-only   structurally, see below
--   recorded    one `support_access_log` row per transaction opened
--
-- ## Why this migration adds policies instead of editing `0004`
--
-- Permissive policies are OR-ed. Adding `for select` policies leaves every
-- existing policy exactly as it was — so this migration cannot weaken the
-- four populations already there, and a reviewer can satisfy themselves of
-- that without re-reading `0004`.
--
-- It also makes read-only *structural* rather than remembered. Support gets
-- `for select` policies and nothing else, so an UPDATE by a support principal
-- does not hit a check that says no — it finds no policy that admits it at
-- all, and fails the way an unrecognised principal type fails. There is no
-- flag to get wrong later.

-- --------------------------------------------------------------------------
-- The principal type and the scope
-- --------------------------------------------------------------------------
--
-- `add value` is safe inside a transaction on PostgreSQL 12+ provided the new
-- label is not *used* before commit. Nothing below uses it as an enum: the
-- policies compare `app.principal_type()`, which is text.

alter type principal_type add value if not exists 'support';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'support_scope') then
    create type support_scope as enum ('read', 'write');
  end if;
end $$;

create table if not exists support_grants (
  id            uuid primary key default uuidv7(),
  principal_id  uuid not null references principals (id),
  granted_by_id uuid not null references principals (id),
  branch_ids    uuid[] not null default '{}'::uuid[],
  scope         support_scope not null default 'read',
  reason        text not null,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoked_by_id uuid references principals (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists support_grants_active_idx
  on support_grants (principal_id, expires_at);
create index if not exists support_grants_granted_by_idx
  on support_grants (granted_by_id);

-- A grant with no ticket behind it is the one an auditor asks about.
alter table support_grants
  add constraint support_grants_reason_not_blank check (length(btrim(reason)) > 0);

-- An expiry in the past is a grant that never worked, which is a mistake worth
-- catching at the point of writing rather than at the point of using.
alter table support_grants
  add constraint support_grants_expiry_future check (expires_at > created_at);

create table if not exists support_access_log (
  id           uuid primary key default uuidv7(),
  grant_id     uuid not null references support_grants (id),
  principal_id uuid not null references principals (id),
  action       text,
  ip           text,
  at           timestamptz not null default now()
);

create index if not exists support_access_log_grant_idx on support_access_log (grant_id, at);

-- --------------------------------------------------------------------------
-- Audit, and a claim in 0003 that was not true
-- --------------------------------------------------------------------------
--
-- `0003_audit.sql` says of its attachment loop: *"Adding a table in a later
-- migration adds its audit automatically, which is the point: universality
-- that does not depend on anyone remembering."*
--
-- It is not automatic. The loop runs once, when 0003 is applied, over the
-- tables that exist at that moment. `support_grants` was created above, three
-- migrations later, and arrived with no audit trigger and no `updated_at`
-- trigger — which the sweep in `rls.test.ts` caught the first time the suite
-- ran against a real database.
--
-- The universality is real, but it comes from the *test* failing the build,
-- not from the migration doing it for you. So the attachment is extracted into
-- a function a later migration can call in one line, and the comment in 0003
-- should be read as describing the obligation rather than the mechanism.

create or replace function app.attach_audit(target text) returns void
  language plpgsql as $$
declare
  key_column text;
begin
  select a.attname into key_column
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = target::regclass and i.indisprimary
   limit 1;

  if key_column is null then
    raise exception 'Table % has no primary key; every audited table needs one.', target;
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = target::regclass and tgname = target || '_audit' and not tgisinternal
  ) then
    execute format(
      'create trigger %I after insert or update or delete on %I
         for each row execute function app.audit(%L)',
      target || '_audit', target, key_column);
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = target and column_name = 'updated_at'
  ) and not exists (
    select 1 from pg_trigger
     where tgrelid = target::regclass and tgname = target || '_touch' and not tgisinternal
  ) then
    execute format(
      'create trigger %I before update on %I
         for each row execute function app.touch_updated_at()',
      target || '_touch', target);
  end if;
end $$;

select app.attach_audit('support_grants');

/*
  `support_access_log` deliberately gets none.

  It is declared a `systemTable` for the same reason `audit_log` is: a trail is
  insert-only, so there is nothing for an audit trigger to record but its own
  inserts, and a trigger on it would recurse.
*/

-- --------------------------------------------------------------------------
-- The predicate every support policy is written in terms of
-- --------------------------------------------------------------------------

create or replace function app.support_grant_id() returns uuid
  language sql stable parallel safe as $$
  select nullif(current_setting('app.support_grant_id', true), '')::uuid
$$;

/*
  Is this transaction a live support session?

  `security definer` because it reads `support_grants`, which a support
  principal can see only the narrow slice of (below) — and the check must not
  depend on the caller being able to read the row that authorises them.

  Every condition here is load-bearing:

    principal type  a grant does not elevate anyone else
    id match        the grant must name *this* principal, so a leaked grant id
                    from another engineer's session is worth nothing
    not revoked     revocation is immediate, not next-login
    not expired     enforced on read; no job has to run for expiry to bite
*/
create or replace function app.support_session() returns support_grants
  language sql stable security definer set search_path = public, pg_temp as $$
  select g.*
    from support_grants g
   where g.id = app.support_grant_id()
     and g.principal_id = app.principal_id()
     and g.revoked_at is null
     and g.expires_at > now()
   limit 1
$$;

create or replace function app.is_support() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select app.principal_type() = 'support' and (app.support_session()).id is not null
$$;

/**
 * Whether an active grant reaches a given branch.
 *
 * An empty `branch_ids` means every branch — a whole-deployment grant, which
 * an operator should have to choose rather than fall into. A null branch on
 * the row (group-shared and configuration tables carry one) is visible to any
 * live session.
 */
create or replace function app.support_sees_branch(target uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not app.is_support() then false
    when target is null       then true
    else coalesce(array_length((app.support_session()).branch_ids, 1), 0) = 0
         or target = any((app.support_session()).branch_ids)
  end
$$;

/** The separate escalation. Read is the default; write is chosen, per grant. */
create or replace function app.support_may_write() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_support() and (app.support_session()).scope = 'write'
$$;

-- --------------------------------------------------------------------------
-- The policies
-- --------------------------------------------------------------------------
--
-- Three shapes, mirroring `0004`. Every one is `for select`.

-- Branch-scoped: every business table carrying a `branch_id`, resolved from
-- the catalogue rather than listed, so a table added later is covered the day
-- it appears rather than the day someone remembers this file.
do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'branch_id'
       and not a.attisdropped
       and c.relname not in ('support_grants', 'support_access_log', 'audit_log')
  loop
    execute format(
      'create policy %I on %I for select using (app.support_sees_branch(%I.branch_id))',
      t.relname || '_support_read', t.relname, t.relname);
  end loop;
end $$;

-- Job-derived: visible exactly when the job is, which now includes the support
-- arm above, so this inherits the branch scoping without restating it.
do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'job_id'
       and not a.attisdropped
       and not exists (
         select 1 from pg_attribute b
          where b.attrelid = c.oid and b.attname = 'branch_id' and not b.attisdropped)
  loop
    execute format(
      'create policy %I on %I for select using (
         app.is_support() and exists (select 1 from jobs j where j.id = %I.job_id))',
      t.relname || '_support_read', t.relname, t.relname);
  end loop;
end $$;

-- Group-shared and configuration: one record across branches, so there is no
-- branch to scope by. A live session sees them; nothing else changes.
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'customer_contacts', 'customer_branch_terms',
    'partners', 'partner_contacts', 'partner_coverage', 'partner_compliance',
    'principals', 'principal_branch_roles', 'branches',
    'quotes', 'quote_lines', 'invoice_lines', 'payment_allocations',
    'message_attachments', 'rate_card_lines', 'notification_deliveries'
  ] loop
    -- Skipped where the table carries a `branch_id` and the branch-scoped loop
    -- above already covered it — `principal_branch_roles` and
    -- `customer_branch_terms` are both in this list conceptually and
    -- branch-scoped physically, and the narrower policy is the right one.
    if to_regclass(t) is not null
       and not exists (
         select 1 from pg_policies
          where schemaname = 'public' and tablename = t and policyname = t || '_support_read')
    then
      execute format(
        'create policy %I on %I for select using (app.is_support())',
        t || '_support_read', t);
    end if;
  end loop;
end $$;

/*
  The audit log is readable by a live session, scoped the same way an internal
  administrator's is — minus the permission check, which a support principal
  cannot hold because it holds no role in this deployment.

  Included deliberately: "what changed on this invoice and who changed it" is
  the single most common thing a support request actually needs, and answering
  it from the trail is strictly better than answering it by reading the rows.
*/
create policy audit_log_support_read on audit_log for select using (
  app.support_sees_branch(branch_id)
);

-- --------------------------------------------------------------------------
-- The write escalation
-- --------------------------------------------------------------------------
--
-- Separate policies, separate scope, and only on the branch-scoped tables — a
-- support engineer has no business inserting a customer or editing the
-- permission matrix. `with check` repeats the qualifier so a write cannot move
-- a row into a branch the grant does not reach.

do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'branch_id'
       and not a.attisdropped
       and c.relname not in ('support_grants', 'support_access_log', 'audit_log')
  loop
    execute format(
      'create policy %I on %I for update
         using      (app.support_may_write() and app.support_sees_branch(%I.branch_id))
         with check (app.support_may_write() and app.support_sees_branch(%I.branch_id))',
      t.relname || '_support_write', t.relname, t.relname, t.relname);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- The grant and log tables themselves
-- --------------------------------------------------------------------------

alter table support_grants enable row level security;
alter table support_grants force  row level security;

/*
  Who may see a grant.

  The operator's staff see every grant against their deployment, always — the
  point of the mechanism is that the customer can see who has access and take
  it away, and a grant they cannot see is a grant they cannot revoke. The
  support principal sees only its own, which is enough to know what it holds
  and not enough to enumerate colleagues.
*/
create policy support_grants_read on support_grants for select using (
  app.principal_type() in ('internal', 'system')
  or principal_id = app.principal_id()
);

/*
  Granting is the operator's act, and `admin.users.write` is the permission
  that already governs who may hand out access in this deployment.

  A support principal is excluded structurally rather than by permission: it
  holds no role here, so `app.has_permission` finds no row and returns false.
  Nobody can extend or renew their own access.
*/
create policy support_grants_write on support_grants for all
  using      (app.has_permission('admin.users.write'))
  with check (app.has_permission('admin.users.write'));

/*
  The operator has to be able to *see* the vendor's engineers.

  `principals_scope` in 0004 shows an internal principal only themselves and
  people holding a role in one of their branches. A support principal holds no
  role in this deployment — that is the entire point of the design — so it is
  invisible to the operator's own staff.

  The consequence was not subtle and was invisible until this ran against a
  real database: every query behind the vendor-access screen joins `principals`
  to name the engineer, the join found nothing, and the page rendered as though
  no support access had ever been granted. A control that silently shows
  nothing is worse than no control, because it reads as reassurance.

  Read-only, and narrow: internal staff see support principals and nothing else
  changes. Permissive policies are OR-ed, so 0004's rule is untouched.
*/
create policy principals_support_visible on principals for select using (
  app.principal_type() in ('internal', 'system') and type = 'support'
);

alter table support_access_log enable row level security;
alter table support_access_log force  row level security;

-- The operator reads the trail — that is the entire point of keeping it. A
-- support principal may read back its own entries and nobody else's.
create policy support_access_log_read on support_access_log for select using (
  app.principal_type() in ('internal', 'system')
  or principal_id = app.principal_id()
);

/*
  A session may write its own entry and no other.

  The `principal_id` and `grant_id` checks are what stop a forged
  `app.support_grant_id` producing a plausible row: `app.is_support()` already
  requires the grant to name this principal, so an entry cannot be attributed
  to a grant the caller does not hold.
*/
create policy support_access_log_insert on support_access_log for insert with check (
  app.is_support()
  and principal_id = app.principal_id()
  and grant_id = app.support_grant_id()
);

-- Insert-only, on the same terms as `audit_log` (§5.4). A trail the party
-- being recorded can edit is not a trail.
revoke update, delete, truncate on support_access_log from public;
revoke update, delete, truncate on support_access_log from app_user;
revoke delete, truncate on support_grants from app_user;
grant insert, select on support_access_log to app_user;
grant select, insert, update on support_grants to app_user;

grant execute on all functions in schema app to app_user;
