-- Finance fixes (sweep part 3). Applied in order; the coordinator turns this
-- file into a custom migration.

-- F2: a hand-raised invoice in a foreign currency has no charge lines to carry
-- its rate, so the accounting export posted it at 1. Nullable on purpose: null
-- means "billed from a job, read the rate from the charge lines" (FR-RT-06).
alter table invoices add column if not exists fx_rate numeric(19, 8);
