/**
 * Quotations, invoices and payments — the money trail.
 *
 * One slice because the three are one story: a quotation becomes an invoice
 * becomes a payment, and every screen that shows one wants a figure from the
 * next. Splitting them would mean three slices joining `customers` three ways
 * to answer the same question.
 *
 * Every amount stays a *string* from `numeric(19,6)` to the formatter. Parsing
 * money into a JavaScript number to render it is how 1234.565 becomes
 * 1234.5649999999998 on a quotation.
 */

import { asc, desc, eq, sql } from 'drizzle-orm'
import {
  branches,
  customers,
  enquiries,
  invoices,
  payments,
  principals,
  quotes,
  withActor,
  type Actor,
} from '@qabandi/db'

// --- quotations ------------------------------------------------------------

export interface QuoteRow {
  readonly id: string
  readonly reference: string
  readonly version: number
  readonly status: string
  readonly currency: string
  readonly totalSell: string | null
  readonly totalCost: string | null
  readonly validUntil: string | null
  readonly sentAt: Date | null
  readonly decidedAt: Date | null
  readonly customerName: string | null
  readonly enquiryReference: string | null
  readonly preparedBy: string | null
  readonly branchCode: string | null
}

export async function listQuotes(actor: Actor, status?: string): Promise<QuoteRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: quotes.id,
        reference: quotes.reference,
        version: quotes.version,
        status: quotes.status,
        currency: quotes.currency,
        totalSell: quotes.totalSell,
        totalCost: quotes.totalCost,
        validUntil: quotes.validUntil,
        sentAt: quotes.sentAt,
        decidedAt: quotes.decidedAt,
        customerName: customers.legalNameEn,
        enquiryReference: enquiries.reference,
        preparedBy: principals.nameEn,
        branchCode: branches.code,
      })
      .from(quotes)
      .leftJoin(enquiries, eq(enquiries.id, quotes.enquiryId))
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .leftJoin(principals, eq(principals.id, quotes.preparedById))
      .leftJoin(branches, eq(branches.id, quotes.branchId))
      .where(status ? eq(quotes.status, status as never) : undefined)
      .orderBy(desc(quotes.createdAt))
      .limit(200),
  )
}

export async function quoteStatusCounts(
  actor: Actor,
): Promise<{ status: string; count: number }[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({ status: quotes.status, count: sql<number>`count(*)::int` })
      .from(quotes)
      .groupBy(quotes.status)
      .orderBy(asc(quotes.status)),
  )
}

// --- invoices --------------------------------------------------------------

export interface InvoiceRow {
  readonly id: string
  readonly seriesNo: string | null
  readonly status: string
  readonly currency: string
  readonly subtotal: string | null
  readonly taxAmount: string | null
  readonly total: string | null
  readonly amountPaid: string | null
  readonly issuedAt: Date | null
  readonly dueOn: string | null
  readonly isCreditNote: boolean
  readonly customerName: string | null
  readonly branchCode: string | null
}

export async function listInvoices(actor: Actor, status?: string): Promise<InvoiceRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: invoices.id,
        seriesNo: invoices.seriesNo,
        status: invoices.status,
        currency: invoices.currency,
        subtotal: invoices.subtotal,
        taxAmount: invoices.taxAmount,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        issuedAt: invoices.issuedAt,
        dueOn: invoices.dueOn,
        isCreditNote: invoices.isCreditNote,
        customerName: customers.legalNameEn,
        branchCode: branches.code,
      })
      .from(invoices)
      .leftJoin(customers, eq(customers.id, invoices.customerId))
      .leftJoin(branches, eq(branches.id, invoices.branchId))
      .where(status ? eq(invoices.status, status as never) : undefined)
      .orderBy(desc(invoices.createdAt))
      .limit(200),
  )
}

/**
 * The receivables position.
 *
 * `outstanding` is total minus paid across everything issued and not settled —
 * the number a finance manager opens the screen for. Summed in SQL against
 * `numeric`, never in JavaScript.
 */
export async function invoiceSummary(actor: Actor): Promise<{
  issued: number
  paid: number
  overdue: number
  outstanding: string
  currency: string | null
}> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select
        count(*) filter (where status = 'issued')::int                      as issued,
        count(*) filter (where status = 'paid')::int                        as paid,
        count(*) filter (where status = 'issued' and due_on < current_date)::int as overdue,
        coalesce(sum(total - coalesce(amount_paid, 0))
                 filter (where status not in ('paid', 'void')), 0)::text    as outstanding,
        (select currency from invoices order by created_at desc limit 1)    as currency
      from invoices
    `)
    const row = result.rows[0] as unknown as
      | {
          issued: number
          paid: number
          overdue: number
          outstanding: string
          currency: string | null
        }
      | undefined

    return {
      issued: row?.issued ?? 0,
      paid: row?.paid ?? 0,
      overdue: row?.overdue ?? 0,
      outstanding: row?.outstanding ?? '0',
      currency: row?.currency ?? null,
    }
  })
}

// --- payments --------------------------------------------------------------

export interface PaymentRow {
  readonly id: string
  readonly amount: string
  readonly currency: string
  readonly receivedOn: string
  readonly method: string | null
  readonly reference: string | null
  readonly customerName: string | null
  readonly branchCode: string | null
  readonly recordedBy: string | null
  readonly allocated: string
}

export async function listPayments(actor: Actor): Promise<PaymentRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: payments.id,
        amount: payments.amount,
        currency: payments.currency,
        receivedOn: payments.receivedOn,
        method: payments.method,
        reference: payments.reference,
        customerName: customers.legalNameEn,
        branchCode: branches.code,
        recordedBy: principals.nameEn,
        // What of this receipt has been matched to an invoice. An unallocated
        // payment is money you have but cannot close a ledger with.
        allocated: sql<string>`coalesce((
          select sum(pa.amount)::text from payment_allocations pa
           where pa.payment_id = ${payments.id}
        ), '0')`,
      })
      .from(payments)
      .leftJoin(customers, eq(customers.id, payments.customerId))
      .leftJoin(branches, eq(branches.id, payments.branchId))
      .leftJoin(principals, eq(principals.id, payments.recordedById))
      .orderBy(desc(payments.receivedOn))
      .limit(200),
  )
}

export async function paymentSummary(
  actor: Actor,
): Promise<{ count: number; received: string; unallocated: number; currency: string | null }> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select
        count(*)::int                                                     as count,
        coalesce(sum(amount), 0)::text                                    as received,
        count(*) filter (where not exists (
          select 1 from payment_allocations pa where pa.payment_id = payments.id
        ))::int                                                           as unallocated,
        (select currency from payments order by received_on desc limit 1) as currency
      from payments
    `)
    const row = result.rows[0] as unknown as
      { count: number; received: string; unallocated: number; currency: string | null } | undefined

    return {
      count: row?.count ?? 0,
      received: row?.received ?? '0',
      unallocated: row?.unallocated ?? 0,
      currency: row?.currency ?? null,
    }
  })
}

/** Whether anything has ever been quoted — used by the empty states. */
export async function hasQuotes(actor: Actor): Promise<boolean> {
  return withActor(actor, async (tx) => {
    const [row] = await tx.select({ id: quotes.id }).from(quotes).limit(1)
    return Boolean(row)
  })
}
