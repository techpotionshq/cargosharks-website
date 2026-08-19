-- Allocating a series number — FR-ID-01, §5.3.
--
-- Both statutory counters live on `branches`: `invoice_series_next` and
-- `house_bill_series_next`. Bumping one is an *operational* act performed by
-- the person issuing the document, but `branches` is configuration, and its
-- write policy says so:
--
--   branches_write  ALL  app.has_permission('admin.branches.write')
--
-- Only `administrator` holds that key. `finance` holds `invoice.issue` and
-- `coordinator` holds `document.release`, and neither may write `branches` —
-- so the `update … returning` that allocated the number matched no rows for
-- exactly the roles that exist to issue these documents. RLS does not raise on
-- a write it filters out; it returns nothing. The two call sites then did what
-- they were written to do with nothing:
--
--   * the invoice threw `not_found`, so issuing failed for every finance user;
--   * the house bill returned quietly, so the bill was released with no number
--     at all and nobody was told.
--
-- ## Why this is a policy and not a security-definer function alone
--
-- The obvious narrow fix — a `security definer` function that bumps the
-- counter — does not work here, and the reason is a deliberate decision made
-- in 0004: every table carries **force** row-level security, and both roles are
-- `nobypassrls`. Forcing RLS means the table's owner is subject to it too, so a
-- definer function running as `app_migrator` is filtered by the very policy it
-- was written to get around. That is the architecture working as intended and
-- not an obstacle to route around.
--
-- So the permission is granted where permissions belong — in a policy — and
-- narrowed to the two columns by a trigger, because a policy cannot say
-- *which columns* an update may touch and this update must never be a way to
-- rewrite a branch's legal name or its control accounts.
--
-- The function stays, because it is the one place that knows how a number is
-- formed and it keeps that knowledge out of two call sites.

-- --------------------------------------------------------------------------
-- The policy: issuing staff may advance their own branch's counters
-- --------------------------------------------------------------------------

create policy branches_allocate_series on branches
  for update
  using (
    app.in_branch(id)
    and (app.has_permission('invoice.issue') or app.has_permission('document.release'))
  )
  with check (
    app.in_branch(id)
    and (app.has_permission('invoice.issue') or app.has_permission('document.release'))
  );

-- --------------------------------------------------------------------------
-- The narrowing: under that policy, only the counters may move
-- --------------------------------------------------------------------------
--
-- Compares the whole row with the permitted columns removed. Anything else
-- differing means the update was not a series allocation, whatever it claimed
-- to be. Written this way rather than column by column so that a column added
-- to `branches` later is protected by default rather than by remembering.

create or replace function app.branches_guard_series_update() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- An administrator edits branches for a living; this is not about them.
  if app.has_permission('admin.branches.write') then
    return new;
  end if;

  if (to_jsonb(new) - 'invoice_series_next' - 'house_bill_series_next' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'invoice_series_next' - 'house_bill_series_next' - 'updated_at')
  then
    raise exception
      'only the series counters may be updated without admin.branches.write'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger branches_guard_series_update
  before update on branches
  for each row execute function app.branches_guard_series_update();

-- --------------------------------------------------------------------------
-- The allocator
-- --------------------------------------------------------------------------

create or replace function app.allocate_series_number(target uuid, kind text)
  returns text
  language plpgsql
  set search_path = public, pg_temp
as $$
declare
  allocated text;
begin
  if kind = 'invoice' then
    update branches
       set invoice_series_next = invoice_series_next + 1,
           updated_at = now()
     where id = target
    returning invoice_series
              || '-' || extract(year from now())::int
              || '-' || lpad((invoice_series_next - 1)::text, 5, '0')
      into allocated;

  elsif kind = 'house_bill' then
    -- A branch with no house-bill series configured keeps whatever was typed
    -- by hand; that is a configuration choice, not a failure.
    update branches
       set house_bill_series_next = house_bill_series_next + 1,
           updated_at = now()
     where id = target
       and house_bill_series is not null
    returning house_bill_series
              || '-' || extract(year from now())::int
              || '-' || lpad((house_bill_series_next - 1)::text, 5, '0')
      into allocated;

  else
    raise exception 'unknown series kind %', kind using errcode = '22023';
  end if;

  return allocated;
end;
$$;

/*
  `- 1` corrects a gap at the start of the series, deliberately.

  `returning` reports each row *after* the update, so reading
  `invoice_series_next` in the same statement that increments it yields the
  value after the bump. Starting from the column default of 1, the previous
  inline SQL therefore issued its first document as `00002` and never used
  `00001` — a gap at the very front of a statutory series, which is the exact
  thing the numbering design exists to prevent.

  Subtracting one returns the number actually claimed, so the series starts at
  `00001` and `…_next` means what it says: the next number to hand out.

  This changes what the counter means relative to the old expression, and that
  is safe here only because of the order these fixes land in: 0015 shows that
  `approved` was refused by check constraint, so no invoice reached `issued` by
  any route, so no counter has ever been advanced by this path. Applying this to
  a deployment that *had* issued invoices under the old expression would re-hand
  a number already used — if one is ever found, advance that branch's counter by
  one before applying rather than dropping this.
*/

revoke all on function app.allocate_series_number(uuid, text) from public;
grant execute on function app.allocate_series_number(uuid, text) to app_user;
