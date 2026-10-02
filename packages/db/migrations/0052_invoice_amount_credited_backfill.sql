-- F9: partial credit notes. 0051 added `invoices.amount_credited`; this fills
-- it for the credit notes already raised and bounds it.
--
-- Until now a credit note always reversed its whole invoice and flipped it to
-- `credited`, and every "what is owed" query left credited invoices out by
-- status. A note may now credit part of an invoice that stays issued or part
-- paid, so the owed figure everywhere becomes total - amount_paid -
-- amount_credited, and the column has to be true for the history as well.
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
   set amount_credited = n.credited
  from (select credits_invoice_id as id, sum(total) as credited
          from invoices
         where is_credit_note and credits_invoice_id is not null and status <> 'void'
         group by credits_invoice_id) n
 where n.id = i.id;

-- Never negative, and never more than the invoice it reduces. Not "paid plus
-- credited within the total": a part-paid invoice credited before this
-- change was credited in full, receipts and all, and that history stands.
alter table invoices add constraint invoices_amount_credited_bounds check (
  amount_credited >= 0 and amount_credited <= total
);
