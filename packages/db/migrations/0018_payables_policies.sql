-- Payables — the half Drizzle does not model.
--
-- 0017 created the tables. This is what makes them safe to use: the checks
-- that keep a set-off arithmetically honest, the trigger that stops a match
-- crossing a branch, the two foreign keys the schema module could not declare
-- without making its import graph cyclic, and the row-level security without
-- which the tables are readable by every branch at once.
--
-- ## Why there is no ceiling on the accrual side
--
-- `core/matching.ts` argues this at length and the constraint is deliberately
-- absent here too: a match that exceeds what the job accrued is the *event*
-- the whole feature exists to detect. We accrued 400, the agent billed 460,
-- and the 60 is the finding. A check refusing it would make the system unable
-- to represent the thing it is for, and the operator would go back to the
-- spreadsheet — which is where they started.
--
-- The ceiling that *is* real — never more of a supplier line than they billed
-- — cannot live here either. It is a sum over sibling rows, and enforcing it
-- in a constraint would need a trigger reading rows the same transaction is
-- still writing. It lives in the mutation, inside the transaction that reads
-- the position, which is the only place it holds under concurrency.

create sequence if not exists settlement_reference_seq start 1;
grant usage, select on sequence settlement_reference_seq to app_user;

comment on column charge_types.variance_tolerance_percent is
  'Permitted drift of a supplier bill from the accrual, as a percentage. Zero means exact.';

comment on column partners.settlement_customer_id is
  'The customer record this partner invoices us as. Null where no current account is run with them.';

comment on column branches.input_tax_account_code is
  'Tax we were charged. Separate from tax_account_code: output tax is a liability, input tax is a receivable from the authority, and a chart that nets them cannot produce the return.';

-- --------------------------------------------------------------------------
-- The two foreign keys the schema module could not declare
-- --------------------------------------------------------------------------

/*
  `charge_lines` lives in `finance.ts` and `supplier_invoices` points back at
  `partner_settlements`, which is declared after it in the same file. Both
  directions cannot be `.references()` in TypeScript without a cycle, so —
  exactly as `assets.branch_id` did in 0003 — one of each pair is declared here.
*/
alter table supplier_invoice_matches
  add constraint supplier_invoice_matches_charge_line_fk
  foreign key (charge_line_id) references charge_lines (id);

alter table supplier_invoices
  add constraint supplier_invoices_settlement_fk
  foreign key (settlement_id) references partner_settlements (id);

alter table supplier_invoices
  add constraint supplier_invoices_export_fk
  foreign key (accounting_export_id) references accounting_exports (id);

alter table supplier_payments
  add constraint supplier_payments_export_fk
  foreign key (accounting_export_id) references accounting_exports (id);

alter table partner_settlements
  add constraint partner_settlements_export_fk
  foreign key (accounting_export_id) references accounting_exports (id);

alter table partner_settlement_lines
  add constraint partner_settlement_lines_invoice_fk
  foreign key (invoice_id) references invoices (id);

-- --------------------------------------------------------------------------
-- What the figures are allowed to say
-- --------------------------------------------------------------------------

alter table supplier_invoices
  add constraint supplier_invoices_paid_within_total check (amount_paid <= total),
  add constraint supplier_invoices_dispute_has_reason check (
    (disputed_at is null) or (dispute_reason is not null and dispute_reason <> '')
  ),
  /*
    Approving a bill that is outside tolerance is a decision, and it is
    recorded as one. "Who decided the 60 KWD overcharge was acceptable, and
    what did they say" is the question this feature exists to answer six months
    later, and an acceptance with no reason cannot answer it.
  */
  add constraint supplier_invoices_variance_has_reason check (
    (variance_accepted_at is null)
    or (variance_accepted_reason is not null and variance_accepted_reason <> '')
  );

alter table supplier_invoice_matches
  add constraint supplier_invoice_matches_positive check (amount > 0);

alter table supplier_payments
  add constraint supplier_payments_positive check (amount > 0);

alter table supplier_payment_allocations
  add constraint supplier_payment_allocations_positive check (amount > 0);

alter table partner_settlements
  add constraint partner_settlements_period_ordered check (period_to >= period_from),
  add constraint partner_settlements_amounts_positive check (
    receivable_total >= 0 and payable_total >= 0
    and offset_amount >= 0 and residual_amount >= 0
  ),
  /*
    A set-off can only extinguish what both sides actually owe.

    Offsetting more than the smaller balance creates a debit balance on a
    payable — an asset dressed as a liability, which reads as a supplier who
    owes us money for no reason anyone can trace. `core/netting.ts` computes it
    correctly; this is what guarantees no other path can write it wrong.
  */
  add constraint partner_settlements_offset_bounded check (
    offset_amount <= least(receivable_total, payable_total)
  ),
  add constraint partner_settlements_residual_consistent check (
    residual_amount = abs(receivable_total - payable_total)
  ),
  add constraint partner_settlements_agreed_status check (
    (status in ('agreed', 'settled')) = (agreed_at is not null)
  ),
  add constraint partner_settlements_void_has_reason check (
    (voided_at is null) or (void_reason is not null and void_reason <> '')
  );

alter table partner_settlement_lines
  add constraint partner_settlement_lines_positive check (amount > 0),
  /*
    Exactly one document per line, and it must be the one the kind names.

    A line claiming both would be counted on both sides of the same set-off; a
    line claiming neither is a number with no provenance, which is the thing
    these rows exist to prevent.
  */
  add constraint partner_settlement_lines_one_document check (
    (kind = 'invoice' and invoice_id is not null and supplier_invoice_id is null)
    or
    (kind = 'bill' and supplier_invoice_id is not null and invoice_id is null)
  );

/*
  A match cannot cross a branch.

  The same shape as 0012's consolidation check, preventing the same class of
  failure: a Dubai bill matched against a Kuwait accrual lands the variance in
  the wrong entity's P&L and the wrong entity's accounting export. A foreign
  key cannot say it — the two branch columns are independent — so a trigger is
  the honest way.
*/
create or replace function app.check_match_branch() returns trigger
  language plpgsql as $$
declare
  line_branch   uuid;
  charge_branch uuid;
begin
  select branch_id into line_branch
    from supplier_invoice_lines where id = new.supplier_invoice_line_id;
  select branch_id into charge_branch
    from charge_lines where id = new.charge_line_id;

  if line_branch is distinct from charge_branch then
    raise exception 'Supplier line and charge line are in different branches'
      using errcode = 'check_violation';
  end if;

  if new.branch_id is distinct from line_branch then
    raise exception 'A match carries the branch of the documents it joins'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger supplier_invoice_matches_branch
  before insert or update of supplier_invoice_line_id, charge_line_id, branch_id
  on supplier_invoice_matches
  for each row execute function app.check_match_branch();

-- --------------------------------------------------------------------------
-- Row-level security, grants, audit
-- --------------------------------------------------------------------------

/*
  Internal only, all seven.

  A supplier invoice names what we pay an agent, which is the one number an
  agent portal must never show a *different* agent, and which a customer has no
  business seeing at all — it is the cost behind their sell price. An agent's
  view of their own account is a deliberate, separate decision with its own
  policy, and is not being made here by omission.

  Support keeps the read-and-escalate-to-write shape 0008 established: the
  overwhelming majority of support work is answering "why does this say that",
  which needs no write at all.
*/
do $$
declare
  t text;
begin
  foreach t in array array[
    'supplier_invoices', 'supplier_invoice_lines', 'supplier_invoice_matches',
    'supplier_payments', 'supplier_payment_allocations',
    'partner_settlements', 'partner_settlement_lines'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$
      create policy %I on %I using (
        case
          when app.principal_type() = 'system'   then true
          when app.principal_type() = 'internal' then branch_id = any(app.branch_ids())
          else false
        end)
    $f$, t || '_scope', t);

    execute format(
      'create policy %I on %I for select using (app.support_sees_branch(%I.branch_id))',
      t || '_support_read', t, t);

    execute format(
      'create policy %I on %I for update
         using      (app.support_may_write() and app.support_sees_branch(%I.branch_id))
         with check (app.support_may_write() and app.support_sees_branch(%I.branch_id))',
      t || '_support_write', t, t, t);

    execute format('grant select, insert, update on %I to app_user', t);
    perform app.attach_audit(t);
  end loop;
end $$;
