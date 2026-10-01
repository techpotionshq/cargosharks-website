-- Finance fixes (sweep part 3). Applied in order; the coordinator turns this
-- file into a custom migration.

-- F2: a hand-raised invoice in a foreign currency has no charge lines to carry
-- its rate, so the accounting export posted it at 1. Nullable on purpose: null
-- means "billed from a job, read the rate from the charge lines" (FR-RT-06).
alter table invoices add column if not exists fx_rate numeric(19, 8);

-- F11: voiding a draft (or an approved invoice) has always failed. The machine
-- allows draft -> void and approved -> void, and neither state has a series
-- number, but 0015's constraint demanded one of every status past approved —
-- so the void was refused with 23514 and a draft billed from a job could never
-- be withdrawn. A void may now be unnumbered; an issued invoice is still never
-- voided (it is credited), so no numbered document loses its number this way.
alter table invoices drop constraint invoices_series_when_issued;

alter table invoices add constraint invoices_series_when_issued check (
  (status in ('draft', 'approved') and series_no is null)
  or status = 'void'
  or (status not in ('draft', 'approved', 'void') and series_no is not null)
);
