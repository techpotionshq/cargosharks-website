-- Architecture §5.4 — audit, and the `updated_at` trigger.
--
-- FR-AD-01 requires that no role, including administrator, can edit an audit
-- entry. Application-level audit logging cannot satisfy that: an administrator
-- with database access edits the row. Revoking UPDATE and DELETE at the
-- database can, and that is why audit is a trigger rather than a helper
-- function called from each mutation.
--
-- It also removes the most likely DRY violation in the codebase: the
-- `audit.log(...)` call someone forgets on the twelfth mutation path.

-- --------------------------------------------------------------------------
-- updated_at
-- --------------------------------------------------------------------------

create or replace function app.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- --------------------------------------------------------------------------
-- The audit trigger
-- --------------------------------------------------------------------------
--
-- `security definer` so it can insert into a table the calling role may only
-- insert into and never read back selectively. `search_path` is pinned, which
-- is mandatory for any security-definer function.

create or replace function app.audit() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  row_data   jsonb;
  branch     uuid;
  key_column text;
begin
  row_data := to_jsonb(coalesce(new, old));

  -- Which column holds this table's primary key. Passed in when the trigger is
  -- attached, so the hot path never queries the catalogue: most tables are
  -- keyed by `id`, but the reference tables an administrator edits are keyed
  -- by `code`, and assuming `id` loses precisely the edits worth auditing.
  key_column := coalesce(tg_argv[0], 'id');

  -- Branch is denormalised onto the entry so the audit viewer can be scoped
  -- without joining back to a table whose row may since have moved.
  if row_data ? 'branch_id' then
    branch := (row_data ->> 'branch_id')::uuid;
  end if;

  insert into audit_log (
    principal_id, principal_type, table_name, row_id, op, before, after, branch_id, ip
  )
  values (
    app.principal_id(),
    app.principal_type(),
    tg_table_name,
    row_data ->> key_column,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    branch,
    app.ip()
  );

  return coalesce(new, old);
end $$;

-- --------------------------------------------------------------------------
-- Attachment
-- --------------------------------------------------------------------------
--
-- A loop over every base table in `public`, minus the ones that must not carry
-- one. Adding a table in a later migration adds its audit automatically, which
-- is the point: universality that does not depend on anyone remembering.
--
-- The exclusions, each for a reason:
--   audit_log               a trigger on it would recurse
--   auth_*                  credential rows; the log must not copy secrets
--   rate_limit_buckets      throttle counters, rewritten constantly
--   inbound_webhook_events  provider receipts, already immutable
--   __drizzle_migrations    migration bookkeeping

do $$
declare
  t          record;
  key_column text;
begin
  for t in
    select c.oid, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname not like 'auth\_%'
       and c.relname not like '\_\_drizzle%'
       and c.relname not in ('audit_log', 'rate_limit_buckets', 'inbound_webhook_events')
  loop
    -- Resolve the primary key once, here, and bake it into the trigger.
    select a.attname into key_column
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = t.oid and i.indisprimary
     limit 1;

    if key_column is null then
      raise exception 'Table % has no primary key; every audited table needs one.', t.relname;
    end if;

    execute format(
      'create trigger %I after insert or update or delete on %I
         for each row execute function app.audit(%L)',
      t.relname || '_audit', t.relname, key_column);

    -- `updated_at` only where the column exists.
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t.relname and column_name = 'updated_at'
    ) then
      execute format(
        'create trigger %I before update on %I
           for each row execute function app.touch_updated_at()',
        t.relname || '_touch', t.relname);
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- Immutability
-- --------------------------------------------------------------------------
--
-- This is the requirement, stated in SQL. The trigger inserts; nobody amends.
-- Note that `app_migrator` owns the table and so could still alter it — which
-- is why migrations are applied by CI from tagged commits (§13) and that role
-- is not available to anyone at runtime.

revoke update, delete, truncate on audit_log from public;
revoke update, delete, truncate on audit_log from app_user;
grant insert, select on audit_log to app_user;
grant usage, select on sequence audit_log_id_seq to app_user;
