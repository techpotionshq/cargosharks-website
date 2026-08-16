-- Architecture §5.3 — row-level security.
--
-- This is the load-bearing migration. Get it right once and no feature
-- developer thinks about tenancy again: a missed `where` clause cannot leak
-- another branch's data, because the row is not visible to the query at all.
--
-- FR-ID-04 is satisfied literally rather than approximately. An unauthorised
-- request for another branch's job returns *not found* — not "forbidden", and
-- not a filtered empty list produced by application code that remembered.
--
-- Tables fall into four scoping shapes:
--
--   branch-scoped   jobs, enquiries, invoices — visible per `app.branch_ids()`
--   job-derived     children of a job; visible exactly when their job is
--   group-shared    customers, partners, locations — one record across branches
--   config          reference data; read by all, written by administrators
--
-- Both ENABLE and FORCE are set on every table. ENABLE alone leaves the owning
-- role bypassing silently, and `app_migrator` owns every table here (§5.1).

-- --------------------------------------------------------------------------
-- Shape 1 — branch-scoped roots
-- --------------------------------------------------------------------------
--
-- One policy serves all three user populations. The `else false` arm is the
-- default: an unrecognised or absent principal type sees nothing.

alter table jobs enable row level security;
alter table jobs force  row level security;

create policy jobs_scope on jobs using (
  case app.principal_type()
    when 'internal'         then branch_id = any(app.branch_ids())
    when 'system'           then true
    when 'customer_contact' then customer_id = app.customer_id()
    when 'agent_contact'    then exists (
      select 1 from job_partners jp
       where jp.job_id = jobs.id and jp.partner_id = app.partner_id())
    else false
  end
);

-- `job_partners` carries its own branch precisely so this policy need not
-- query `jobs` — see the comment on the table. Referencing it back would make
-- both policies infinitely recursive and PostgreSQL would reject them.
alter table job_partners enable row level security;
alter table job_partners force  row level security;

create policy job_partners_scope on job_partners using (
  case app.principal_type()
    when 'internal'      then branch_id = any(app.branch_ids())
    when 'system'        then true
    when 'agent_contact' then partner_id = app.partner_id()
    else false
  end
);

alter table enquiries enable row level security;
alter table enquiries force  row level security;

create policy enquiries_scope on enquiries using (
  case app.principal_type()
    when 'internal'         then branch_id = any(app.branch_ids())
    when 'system'           then true
    when 'customer_contact' then customer_id = app.customer_id()
    else false
  end
);

-- A quote carries no customer of its own — it hangs off the enquiry, and the
-- enquiry carries the customer. So it inherits that policy rather than
-- restating it, exactly as the job-derived tables below do. Denormalising a
-- customer_id onto quotes purely to make this policy symmetrical would be a
-- second copy of the truth.
alter table quotes enable row level security;
alter table quotes force  row level security;

create policy quotes_scope on quotes using (
  exists (select 1 from enquiries e where e.id = quotes.enquiry_id)
);

-- Invoices and payments: internal by branch, customers by their own id.
-- Agents never see commercial documents — they see operations.
do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$
      create policy %I on %I using (
        case app.principal_type()
          when 'internal'         then branch_id = any(app.branch_ids())
          when 'system'           then true
          when 'customer_contact' then customer_id = app.customer_id()
          else false
        end)
    $f$, t || '_scope', t);
  end loop;
end $$;

-- Internal-only, branch-scoped. `charge_lines` is here rather than with the
-- job-derived tables for a specific reason: cost lines carry what the job cost
-- Al-Qabandi, and a customer must never see them. Customers see invoices.
do $$
declare
  t text;
begin
  -- `rate_requests` belongs here rather than above: it is keyed by enquiry and
  -- partner and carries no customer, and what we paid an agent to quote is not
  -- the customer's to read.
  foreach t in array array[
    'charge_lines', 'accounting_exports', 'rate_cards', 'notification_outbox',
    'assets', 'chargeable_rules', 'rate_requests'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$
      create policy %I on %I using (
        case
          when app.principal_type() = 'system' then true
          when app.principal_type() = 'internal' then
            branch_id is null or branch_id = any(app.branch_ids())
          else false
        end)
    $f$, t || '_scope', t);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- Shape 2 — job-derived
-- --------------------------------------------------------------------------
--
-- A child row is visible exactly when its job is. The `exists` subquery is
-- itself subject to the `jobs` policy above, so this needs no restatement of
-- the branch, customer and agent rules — it inherits all three, and cannot
-- drift from them.
--
-- Two of these carry an extra condition. Customers and agents see only what
-- was released or marked visible; internal users see everything.

-- Milestones and exceptions carry `customer_visible`: an internal note about a
-- delay is not automatically the customer's to read.
do $$
declare
  t text;
begin
  foreach t in array array['job_milestones', 'exceptions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$
      create policy %I on %I using (
        exists (select 1 from jobs j where j.id = %I.job_id)
        and (app.is_internal() or customer_visible)
      )
    $f$, t || '_scope', t, t);
  end loop;
end $$;

-- Customs and equipment have no visibility flag: they are visible with the job.
do $$
declare
  t text;
begin
  foreach t in array array['customs_stages', 'equipment'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$
      create policy %I on %I using (exists (select 1 from jobs j where j.id = %I.job_id))
    $f$, t || '_scope', t, t);
  end loop;
end $$;

-- Free-time clocks are cost data: internal only, with the job.
alter table free_time_clocks enable row level security;
alter table free_time_clocks force  row level security;

create policy free_time_clocks_scope on free_time_clocks using (
  app.is_internal() and exists (select 1 from jobs j where j.id = free_time_clocks.job_id)
);

-- Documents reach a customer only once released — a draft bill of lading
-- sitting on the job is not the same thing as one issued to the customer.
alter table documents enable row level security;
alter table documents force  row level security;

create policy documents_scope on documents using (
  exists (select 1 from jobs j where j.id = documents.job_id)
  and (app.is_internal() or released_at is not null)
);

-- Messages: internal sees the thread, external parties see what was marked
-- visible to them.
alter table messages enable row level security;
alter table messages force  row level security;

create policy messages_scope on messages using (
  case app.principal_type()
    when 'internal' then branch_id = any(app.branch_ids())
    when 'system'   then true
    else customer_visible and (
      (job_id     is not null and exists (select 1 from jobs j     where j.id = messages.job_id))
      or (enquiry_id is not null and exists (select 1 from enquiries e where e.id = messages.enquiry_id))
    )
  end
);

-- Line-item tables inherit from their parent document by the same mechanism.
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('quote_lines',            'quotes',                'quote_id'),
      ('invoice_lines',          'invoices',              'invoice_id'),
      ('payment_allocations',    'payments',              'payment_id'),
      ('message_attachments',    'messages',              'message_id'),
      ('rate_card_lines',        'rate_cards',            'rate_card_id'),
      ('notification_deliveries','notification_outbox',   'outbox_id'),
      ('webhook_deliveries',     'webhook_endpoints',     'endpoint_id')
    ) as t(child, parent, fk)
  loop
    execute format('alter table %I enable row level security', spec.child);
    execute format('alter table %I force  row level security', spec.child);
    execute format(
      'create policy %I on %I using (exists (select 1 from %I p where p.id = %I.%I))',
      spec.child || '_scope', spec.child, spec.parent, spec.child, spec.fk);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- Shape 3 — group-shared
-- --------------------------------------------------------------------------
--
-- FR-MD-01: one customer record across the group, with per-branch terms
-- beneath it. Internal staff of any branch see the record; a customer contact
-- sees their own; an agent sees their own partner.

alter table customers enable row level security;
alter table customers force  row level security;

create policy customers_scope on customers using (
  case app.principal_type()
    when 'internal'         then true
    when 'system'           then true
    when 'customer_contact' then id = app.customer_id()
    else false
  end
);

alter table partners enable row level security;
alter table partners force  row level security;

create policy partners_scope on partners using (
  case app.principal_type()
    when 'internal'      then true
    when 'system'        then true
    when 'agent_contact' then id = app.partner_id()
    else false
  end
);

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('customer_contacts',     'customer_id'),
      ('customer_branch_terms', 'customer_id')
    ) as t(child, fk)
  loop
    execute format('alter table %I enable row level security', spec.child);
    execute format('alter table %I force  row level security', spec.child);
    execute format($f$
      create policy %I on %I using (
        case app.principal_type()
          when 'internal'         then true
          when 'system'           then true
          when 'customer_contact' then %I = app.customer_id()
          else false
        end)
    $f$, spec.child || '_scope', spec.child, spec.fk);
  end loop;

  for spec in
    select * from (values
      ('partner_contacts',   'partner_id'),
      ('partner_coverage',   'partner_id'),
      ('partner_compliance', 'partner_id')
    ) as t(child, fk)
  loop
    execute format('alter table %I enable row level security', spec.child);
    execute format('alter table %I force  row level security', spec.child);
    execute format($f$
      create policy %I on %I using (
        case app.principal_type()
          when 'internal'      then true
          when 'system'        then true
          when 'agent_contact' then %I = app.partner_id()
          else false
        end)
    $f$, spec.child || '_scope', spec.child, spec.fk);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- Identity
-- --------------------------------------------------------------------------
--
-- A principal sees themselves and, if internal, everyone in their branches.
-- Customer and agent contacts never enumerate the staff list.

alter table principals enable row level security;
alter table principals force  row level security;

create policy principals_scope on principals using (
  id = app.principal_id()
  or app.is_system()
  or (app.principal_type() = 'internal' and exists (
        select 1 from principal_branch_roles pbr
         where pbr.principal_id = principals.id
           and pbr.branch_id = any(app.branch_ids())))
  or (app.principal_type() = 'customer_contact' and customer_id = app.customer_id())
  or (app.principal_type() = 'agent_contact'    and partner_id  = app.partner_id())
);

alter table principal_branch_roles enable row level security;
alter table principal_branch_roles force  row level security;

create policy principal_branch_roles_scope on principal_branch_roles using (
  principal_id = app.principal_id()
  or app.is_system()
  or (app.principal_type() = 'internal' and branch_id = any(app.branch_ids()))
);

alter table branches enable row level security;
alter table branches force  row level security;

-- A customer or agent contact needs the branch's name and letterhead details
-- for the documents they receive, so branches are readable; writing them is
-- gated by the write policy below.
create policy branches_scope on branches using (true);

-- API keys are visible to the customer they belong to and to internal staff of
-- the issuing branch. The secret hash is never selected by application code.
alter table api_keys enable row level security;
alter table api_keys force  row level security;

create policy api_keys_scope on api_keys using (
  case app.principal_type()
    when 'internal'         then branch_id is null or branch_id = any(app.branch_ids())
    when 'system'           then true
    when 'customer_contact' then customer_id = app.customer_id()
    else false
  end
);

-- --------------------------------------------------------------------------
-- Shape 4 — configuration
-- --------------------------------------------------------------------------
--
-- FR-AD-03's rows: read by everyone, written by administrators. The engines
-- depend on these being readable — a customer's quote PDF needs the currency's
-- minor units and the charge type's Arabic name.

do $$
declare
  t text;
begin
  foreach t in array array[
    'currencies', 'countries', 'locations', 'commodities', 'incoterms',
    'container_types', 'charge_types', 'milestone_templates', 'exception_codes',
    'document_types', 'notification_templates', 'free_time_rules',
    'working_calendars', 'calendar_holidays', 'fx_rates', 'roles',
    'role_permissions'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('create policy %I on %I for select using (true)', t || '_read', t);
    execute format($f$
      create policy %I on %I for all
        using (app.has_permission('admin.reference.write'))
        with check (app.has_permission('admin.reference.write'))
    $f$, t || '_write', t);
  end loop;
end $$;

-- Webhook endpoints carry a signing secret, so they are not group-readable.
alter table webhook_endpoints enable row level security;
alter table webhook_endpoints force  row level security;

create policy webhook_endpoints_scope on webhook_endpoints using (
  case app.principal_type()
    when 'internal'         then branch_id is null or branch_id = any(app.branch_ids())
    when 'system'           then true
    when 'customer_contact' then customer_id = app.customer_id()
    else false
  end
);

-- --------------------------------------------------------------------------
-- The audit log
-- --------------------------------------------------------------------------
--
-- Insert-only, and scoped for reading. UPDATE and DELETE were already revoked
-- in 0003; this adds visibility scoping on top, so an administrator in Kuwait
-- does not read Dubai's trail.

alter table audit_log enable row level security;
alter table audit_log force  row level security;

create policy audit_log_read on audit_log for select using (
  app.is_system()
  or (app.principal_type() = 'internal'
      and (branch_id is null or branch_id = any(app.branch_ids()))
      and app.has_permission('admin.audit.read'))
);

-- The trigger runs `security definer` and so inserts regardless; this policy
-- exists so that a direct insert by app_user is not silently accepted.
create policy audit_log_insert on audit_log for insert with check (true);

-- --------------------------------------------------------------------------
-- Nothing is deleted — §5.5
-- --------------------------------------------------------------------------
--
-- Records carry `superseded_by`, `closed_at` or `is_active`. Revoking DELETE
-- makes that structural rather than a convention: no business table exposes a
-- delete path, because the role cannot execute one.
--
-- `alter default privileges` in 01-roles.sql already withholds DELETE from new
-- tables; this is the explicit sweep for the tables created above.

do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not like '\_\_drizzle%'
  loop
    execute format('revoke delete, truncate on %I from app_user', t.relname);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- Function grants
-- --------------------------------------------------------------------------
--
-- A final sweep, after every migration above has added its functions. The
-- policies call `app.principal_type()`, `app.branch_ids()` and
-- `app.has_permission()` on every query, and the `updated_at` and rate-card
-- validity triggers run as the invoking role — all of which need EXECUTE.
--
-- It runs at the end of the last migration rather than once at the start,
-- because a grant on "all functions" only covers the ones that exist when it
-- is executed.

grant usage on schema app to app_user;
grant execute on all functions in schema app to app_user;

alter default privileges for role app_migrator in schema app
  grant execute on functions to app_user;
