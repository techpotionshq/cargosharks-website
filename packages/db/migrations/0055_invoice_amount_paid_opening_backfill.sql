-- F22: a payment made before cutover. 0054 added
-- `invoices.amount_paid_opening`; this fills it for invoices already imported.
--
-- The open-receivables import wrote `amount_paid` straight from the sheet with
-- no receipt behind it, and `rederiveInvoiceSettlement` recomputes
-- `amount_paid` from receipts and set-offs alone — so the first receipt or
-- netting against an imported invoice put the pre-cutover payment back on the
-- customer. Whatever `amount_paid` holds beyond what receipts and agreed or
-- settled set-offs explain is that opening payment. Credit notes are left out:
-- they carry their own `amount_paid`, equal to their total, by design.
--
-- Runs as the system principal for the reason 0050 gives: `invoices` is under
-- forced row level security and `app_migrator` holds no BYPASSRLS.

select set_config('app.principal_id', '00000000-0000-7000-8000-000000000000', true),
       set_config('app.principal_type', 'system', true),
       set_config('app.branch_ids', '', true),
       set_config('app.customer_id', '', true),
       set_config('app.partner_id', '', true),
       set_config('app.ip', '', true);

update invoices i
   set amount_paid_opening = i.amount_paid - s.explained
  from (select inv.id,
               coalesce((select sum(pa.amount) from payment_allocations pa
                          where pa.invoice_id = inv.id), 0)
             + coalesce((select sum(sl.amount) from partner_settlement_lines sl
                           join partner_settlements ps on ps.id = sl.settlement_id
                          where sl.invoice_id = inv.id
                            and ps.status in ('agreed', 'settled')), 0) as explained
          from invoices inv
         where not inv.is_credit_note) s
 where s.id = i.id
   and i.amount_paid > s.explained;

alter table invoices add constraint invoices_amount_paid_opening_bounds check (
  amount_paid_opening >= 0 and amount_paid_opening <= total
);
