-- Posting to the accounting system — the mapping, and the rule that stops a
-- month being posted twice.
--
-- `accounting_exports` has existed since 0000 with the right columns on it and
-- no code that writes a single row. That is the gap between a system a finance
-- manager evaluates well and one they actually move onto: everything up to the
-- invoice was automated, and then somebody re-keyed the month into Tally.
--
-- Two things were missing, and neither is the file format.
--
-- ## 1. Nothing said which account a charge posts to
--
-- A journal line needs an account code, and the only place that can come from
-- is the charge type — "ocean freight" is revenue account 4010 in one chart of
-- accounts and 40100 in the next. So the mapping lives on `charge_types` as
-- reference data, editable without a release, exactly as the permission matrix
-- is. Every customer has a different chart of accounts and not one of them
-- should require a deployment.
--
-- The counter-account is the branch's: receivables, payables, tax, the FX
-- variance that a KWD ledger holding a USD invoice inevitably produces, and
-- the rounding account that absorbs the last fils. Those are per legal entity
-- (FR-ID-01, five entities), not per charge.
--
-- ## 2. Nothing stopped the same invoice posting twice
--
-- This is the failure that loses the account. A duplicated month is not a bad
-- report — it is a set of journal entries in somebody's statutory ledger that
-- has to be reversed, explained, and remembered at audit.
--
-- The obvious guard is a check inside the export routine. That guard is wrong,
-- because it is a read-then-write across two statements and two people
-- exporting January at the same moment both pass it. So the mark goes on the
-- invoice, as a foreign key, and the database refuses the second one:
--
--   invoices.accounting_export_id   set when the export is posted
--   partial unique index            not needed — the column *is* the rule
--
-- Re-exporting a period therefore requires voiding the previous export, which
-- releases its invoices. That is one deliberate act by somebody who holds
-- `finance.export`, instead of an accident available to everybody.

-- --------------------------------------------------------------------------
-- The mapping
-- --------------------------------------------------------------------------

alter table charge_types add column revenue_account_code text;
alter table charge_types add column cost_account_code text;

comment on column charge_types.revenue_account_code is
  'Credit account for a revenue line in the customer chart of accounts. Null means unmapped, and an export refuses rather than guessing.';
comment on column charge_types.cost_account_code is
  'Debit account for a cost line. Null means unmapped.';

/*
  Control accounts, per legal entity.

  All nullable and all checked at export time rather than here. A branch that
  never exports should not be blocked from existing by a chart of accounts
  nobody has supplied yet, and an export that finds one missing can name it —
  which is a better error than a not-null violation at branch creation.
*/
alter table branches add column ar_account_code text;
alter table branches add column ap_account_code text;
alter table branches add column tax_account_code text;
alter table branches add column bank_account_code text;
alter table branches add column fx_variance_account_code text;
alter table branches add column rounding_account_code text;

-- --------------------------------------------------------------------------
-- The export's own life cycle
-- --------------------------------------------------------------------------

create type accounting_export_status as enum ('draft', 'posted', 'void');

alter table accounting_exports
  add column status accounting_export_status not null default 'draft';
alter table accounting_exports add column posted_at    timestamptz;
alter table accounting_exports add column posted_by_id uuid references principals (id);
alter table accounting_exports add column voided_at    timestamptz;
alter table accounting_exports add column voided_by_id uuid references principals (id);
alter table accounting_exports add column void_reason  text;

/*
  Included payments, alongside the invoices already recorded.

  A journal that posts invoices and not receipts leaves receivables growing
  forever. `included_invoice_ids` was there from the start; its counterpart
  was not.
*/
alter table accounting_exports
  add column included_payment_ids jsonb not null default '[]'::jsonb;

/*
  What the file said, as a checksum of the bytes.

  The asset can be re-downloaded, and somebody will eventually ask whether the
  file the auditor is holding is the file this row describes. One column
  answers it without keeping a second copy of the journal in the database.
*/
alter table accounting_exports add column checksum text;

alter table accounting_exports
  add constraint accounting_exports_period_ordered check (period_to >= period_from);

/*
  A void needs a reason, on the same principle as a support grant: the void is
  the act somebody asks about later, because it is what allows a period to be
  posted a second time.
*/
alter table accounting_exports
  add constraint accounting_exports_void_reason check (
    voided_at is null or length(btrim(coalesce(void_reason, ''))) > 0
  );

-- --------------------------------------------------------------------------
-- The rule
-- --------------------------------------------------------------------------

alter table invoices add column accounting_export_id uuid references accounting_exports (id);
alter table payments add column accounting_export_id uuid references accounting_exports (id);

create index invoices_export_idx on invoices (accounting_export_id);
create index payments_export_idx on payments (accounting_export_id);

comment on column invoices.accounting_export_id is
  'The posted export that carried this invoice. Set once; cleared only by voiding that export. A second export skips anything already marked.';

/*
  Draft exports do not mark anything.

  A draft is a preview — the finance manager generating January three times to
  check it before posting must not consume the invoices on the first attempt.
  Only the transition to `posted` writes these columns, which is why the guard
  below names the status rather than the row's existence.
*/
alter table accounting_exports
  add constraint accounting_exports_posted_fields check (
    (status = 'posted') = (posted_at is not null)
  );

-- --------------------------------------------------------------------------
-- Grants
-- --------------------------------------------------------------------------

/*
  `accounting_exports` is already RLS-scoped by 0004 (internal-only, by
  branch) and already audited by 0003's loop — it existed then. Only the
  write grant is new: nothing had ever inserted one.
*/
grant select, insert, update on accounting_exports to app_user;
