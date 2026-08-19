-- An approved invoice has no number yet — FR-ID-01, and the invoice machine.
--
-- `invoices_series_when_issued` (0002) was written as "draft, or numbered":
--
--   (status = 'draft'  and series_no is null)
--   or (status <> 'draft' and series_no is not null)
--
-- That is right about the two states it names and wrong about the one between
-- them. `core/states.ts` routes every invoice `draft → approved → issued`, and
-- the number is allocated *at issue* — deliberately, because an approved
-- invoice that is never issued must not consume one, and a gap in a statutory
-- series is what an auditor asks about.
--
-- So `approved` is a state with no number, and the constraint refused it. The
-- effect was not a subtle one: `setInvoiceStatus` could not persist an
-- approval at all, it failed with 23514 every time, and because `issued` is
-- only reachable *through* `approved`, no invoice in the product could be
-- issued by any route. The demo data hid it by writing `series_no` directly at
-- insert, so every screen showed numbered invoices and the path that numbers
-- them had never run.
--
-- The rule the constraint meant to state, with the middle state included:
-- a number exists from `issued` onwards and not before.

alter table invoices drop constraint invoices_series_when_issued;

alter table invoices add constraint invoices_series_when_issued check (
  (status in ('draft', 'approved') and series_no is null)
  or (status not in ('draft', 'approved') and series_no is not null)
);
