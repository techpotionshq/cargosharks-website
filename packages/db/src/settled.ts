/**
 * What has been set against an invoice or a bill, and what that makes it.
 *
 * Here rather than in a feature slice because two slices need the same rule
 * and they cannot import each other: the ledger allocates receipts to
 * invoices, payables allocates payments to bills, and netting with an agent
 * (also payables) extinguishes both at once. Each used to keep its own copy of
 * "paid-to-date is the sum of allocations", and netting kept none — so an
 * invoice netted away stayed owed in ageing and dunning, and a netted bill
 * stayed `approved` and could be paid a second time.
 *
 * Both functions take the caller's transaction. They write, and the write has
 * to land in the same unit of work as the allocation or the settlement that
 * caused it, or the sub-ledger and the document disagree for a moment that a
 * concurrent reader can see.
 *
 * "Set against" is receipts or payments *plus* the lines of agreed or settled
 * partner settlements. A draft settlement has claimed nothing yet, and a void
 * one has released what it claimed — which is why re-deriving rather than
 * incrementing is the only correct shape: voiding a settlement just calls this
 * again and the balance comes back.
 */

import { sql } from 'drizzle-orm'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

/**
 * An invoice's `amount_paid`, `amount_credited` and status, from its
 * allocations, set-offs and credit notes.
 *
 * "Set against" includes `amount_paid_opening`: a payment made before
 * cutover, carried on an imported invoice with no receipt row behind it. Left
 * out, the first receipt wiped it (F22).
 *
 * Only an invoice that is issued, part paid or paid moves. A draft, a void and
 * a credited invoice keep their status whatever is set against them — the
 * callers refuse those cases before they get here, and a status this function
 * invented for them would be a second, quieter state machine.
 *
 * Credit notes (F9) reduce what is owed without being money received: they
 * count towards "settled in full" — an invoice part credited and the rest
 * received is paid — but never make an invoice `part_paid` on their own. One
 * part credited and otherwise untouched is still `issued`, with less owed.
 * The credit that closes an invoice outright moves it to `credited`, and that
 * is the crediting action's transition, not this function's.
 */
export async function rederiveInvoiceSettlement(tx: Tx, invoiceId: string): Promise<void> {
  await tx.execute(sql`
    with settled as (
      select coalesce((select sum(amount) from payment_allocations
                        where invoice_id = ${invoiceId}), 0)
           + coalesce((select sum(sl.amount) from partner_settlement_lines sl
                         join partner_settlements ps on ps.id = sl.settlement_id
                        where sl.invoice_id = ${invoiceId}
                          and ps.status in ('agreed', 'settled')), 0)
           -- Paid before cutover, with no receipt behind it (F22).
           + (select i.amount_paid_opening from invoices i where i.id = ${invoiceId}) as amount,
             coalesce((select sum(n.total) from invoices n
                        where n.credits_invoice_id = ${invoiceId}
                          and n.is_credit_note and n.status <> 'void'), 0) as credited
    )
    update invoices set
      amount_paid = (select amount from settled),
      amount_credited = (select credited from settled),
      status = case
        when status not in ('issued', 'part_paid', 'paid') then status
        when (select amount + credited from settled) >= total then 'paid'::invoice_status
        when (select amount from settled) > 0 then 'part_paid'::invoice_status
        else 'issued'::invoice_status
      end,
      updated_at = now()
    where id = ${invoiceId}
  `)
}

/** The same for a supplier's bill: payments plus agreed set-offs. */
export async function rederiveBillSettlement(tx: Tx, billId: string): Promise<void> {
  await tx.execute(sql`
    with settled as (
      select coalesce((select sum(amount) from supplier_payment_allocations
                        where supplier_invoice_id = ${billId}), 0)
           + coalesce((select sum(sl.amount) from partner_settlement_lines sl
                         join partner_settlements ps on ps.id = sl.settlement_id
                        where sl.supplier_invoice_id = ${billId}
                          and ps.status in ('agreed', 'settled')), 0) as amount
    )
    update supplier_invoices set
      amount_paid = (select amount from settled),
      status = case
        when status not in ('approved', 'part_paid', 'paid') then status
        when (select amount from settled) >= total then 'paid'::supplier_invoice_status
        when (select amount from settled) > 0 then 'part_paid'::supplier_invoice_status
        else 'approved'::supplier_invoice_status
      end,
      updated_at = now()
    where id = ${billId}
  `)
}
