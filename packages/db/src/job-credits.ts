/**
 * What credit notes have handed back on a job's revenue, in its base currency.
 *
 * Here rather than in a feature slice because two readers need the same figure
 * and must not disagree: the costing card on the job file and the assistant's
 * margin tool. Both reduce the charge ledger with core's `jobMargin`, and a
 * credit note writes invoice lines and no charge line, so both kept the whole
 * sell figure after a credit (N6).
 *
 * A credit note belongs to an invoice, and an invoice can bill several jobs.
 * So the job's share of a credit is the credited fraction of the invoice's
 * subtotal applied to the job's own revenue lines on that invoice, in
 * `amount_base`, the base amounts those lines were taken at. A ratio needs no
 * rate: the invoice, its notes and its subtotal are in one currency whatever it
 * is, and the base figures were fixed when the lines were priced. Subtotals,
 * not totals, because charge lines are net of tax and so is the revenue they
 * sum to. A void note has credited nothing.
 */

import { sql } from 'drizzle-orm'
import type { Tx } from './actor'

export async function creditedRevenueFor(tx: Tx, jobId: string): Promise<string> {
  const result = await tx.execute(sql`
    with billed as (
      select cl.invoice_id, sum(cl.amount_base) as job_base
        from charge_lines cl
       where cl.job_id = ${jobId}::uuid
         and cl.direction = 'revenue'
         and cl.invoice_id is not null
       group by cl.invoice_id
    )
    select coalesce(round(sum(b.job_base * credited.subtotal / i.subtotal), 6), 0)::text as credited
      from billed b
      join invoices i on i.id = b.invoice_id and i.subtotal <> 0 and not i.is_credit_note
      join lateral (
        select sum(n.subtotal) as subtotal
          from invoices n
         where n.credits_invoice_id = i.id and n.is_credit_note and n.status <> 'void'
      ) credited on credited.subtotal is not null
  `)
  return (result.rows[0] as { credited: string } | undefined)?.credited ?? '0'
}
