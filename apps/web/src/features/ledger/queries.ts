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
        count(*) filter (where status not in ('paid', 'void', 'draft'))::int as issued,
        count(*) filter (where status = 'paid')::int                         as paid,
        count(*) filter (where status not in ('paid', 'void', 'draft')
                           and due_on < current_date)::int                   as overdue,
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
           where pa.payment_id = "payments"."id"
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

/**
 * Receivables ageing — the finance overview's centrepiece.
 *
 * The one report every finance function in every business runs, and the one
 * shape that answers "how bad is it" in a glance: what is not yet due, and
 * then how far past due the rest is. Buckets are the conventional 30/60/90
 * because that is what a credit controller already reads, and inventing
 * different boundaries would mean nobody could compare it to their bank's.
 *
 * Computed entirely in one statement against `due_on`, so the answer cannot
 * drift from the invoice register beside it.
 */
export interface AgeingBucket {
  readonly key: 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'
  readonly count: number
  readonly amount: string
}

export async function receivablesAgeing(
  actor: Actor,
): Promise<{ buckets: AgeingBucket[]; total: string; currency: string | null }> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      with open_invoices as (
        select due_on, currency, (total - coalesce(amount_paid, 0)) as balance
          from invoices
         where status not in ('paid', 'void', 'draft')
           and total > coalesce(amount_paid, 0)
      )
      select
        coalesce(sum(balance) filter (where due_on >= current_date), 0)::text as current_amount,
        count(*)              filter (where due_on >= current_date)::int      as current_count,
        coalesce(sum(balance) filter (where current_date - due_on between 1 and 30), 0)::text  as d1_30_amount,
        count(*)              filter (where current_date - due_on between 1 and 30)::int       as d1_30_count,
        coalesce(sum(balance) filter (where current_date - due_on between 31 and 60), 0)::text as d31_60_amount,
        count(*)              filter (where current_date - due_on between 31 and 60)::int      as d31_60_count,
        coalesce(sum(balance) filter (where current_date - due_on between 61 and 90), 0)::text as d61_90_amount,
        count(*)              filter (where current_date - due_on between 61 and 90)::int      as d61_90_count,
        coalesce(sum(balance) filter (where current_date - due_on > 90), 0)::text              as d90_plus_amount,
        count(*)              filter (where current_date - due_on > 90)::int                   as d90_plus_count,
        coalesce(sum(balance), 0)::text as total,
        (select currency from open_invoices limit 1) as currency
      from open_invoices
    `)

    const row = result.rows[0] as Record<string, string | number | null> | undefined
    const bucket = (key: AgeingBucket['key']): AgeingBucket => ({
      key,
      count: Number(row?.[`${key}_count`] ?? 0),
      amount: String(row?.[`${key}_amount`] ?? '0'),
    })

    return {
      buckets: [
        bucket('current'),
        bucket('d1_30'),
        bucket('d31_60'),
        bucket('d61_90'),
        bucket('d90_plus'),
      ],
      total: String(row?.total ?? '0'),
      currency: (row?.currency as string | null) ?? null,
    }
  })
}

/**
 * Who owes the most, and how overdue the worst of it is.
 *
 * Ordered by balance rather than by how late it is: chasing the largest
 * exposure first is what a credit controller actually does, and the oldest
 * debt is frequently the smallest and the least collectable.
 */
export interface DebtorRow {
  readonly customerId: string
  readonly customerName: string
  readonly balance: string
  readonly currency: string
  readonly invoiceCount: number
  readonly oldestDueOn: string | null
  readonly daysOverdue: number
}

export async function topDebtors(actor: Actor, limit = 8): Promise<DebtorRow[]> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select c.id                                            as "customerId",
             c.legal_name_en                                 as "customerName",
             sum(i.total - coalesce(i.amount_paid, 0))::text as balance,
             max(i.currency)                                 as currency,
             count(*)::int                                   as "invoiceCount",
             min(i.due_on)::text                             as "oldestDueOn",
             greatest(0, current_date - min(i.due_on))::int  as "daysOverdue"
        from invoices i
        join customers c on c.id = i.customer_id
       where i.status not in ('paid', 'void', 'draft')
         and i.total > coalesce(i.amount_paid, 0)
       group by c.id, c.legal_name_en
       order by sum(i.total - coalesce(i.amount_paid, 0)) desc
       limit ${limit}
    `)
    return result.rows as unknown as DebtorRow[]
  })
}

// --- detail reads ----------------------------------------------------------

export interface QuoteDetail {
  readonly id: string
  readonly reference: string
  readonly enquiryId: string
  readonly enquiryReference: string
  readonly branchId: string
  readonly branchCode: string | null
  readonly customerId: string | null
  readonly customerName: string | null
  readonly version: number
  readonly status: string
  readonly currency: string
  readonly totalSell: string | null
  readonly totalCost: string | null
  readonly validUntil: string | null
  readonly preparedBy: string | null
  readonly sentAt: Date | null
  readonly decidedAt: Date | null
  readonly createdAt: Date
  readonly lane: string | null
  readonly mode: string | null
  readonly notes: string | null
  readonly lines: readonly {
    id: string
    chargeName: string
    description: string | null
    basis: string
    quantity: string
    rate: string
    amount: string
    currency: string
  }[]
  /** Earlier versions of the same quotation, newest first. */
  readonly history: readonly { id: string; reference: string; version: number; status: string }[]
}

export async function getQuoteDetail(actor: Actor, id: string): Promise<QuoteDetail | undefined> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select q.id, q.reference, q.enquiry_id as "enquiryId", e.reference as "enquiryReference",
             q.branch_id as "branchId", b.code as "branchCode",
             e.customer_id as "customerId", c.legal_name_en as "customerName",
             q.version, q.status::text as status, q.currency,
             q.total_sell::text as "totalSell", q.total_cost::text as "totalCost",
             q.valid_until::text as "validUntil",
             p.name_en as "preparedBy",
             q.sent_at as "sentAt", q.decided_at as "decidedAt", q.created_at as "createdAt",
             case when o.name_en is null or d.name_en is null then null
                  else o.name_en || ' → ' || d.name_en end as lane,
             e.mode::text as mode,
             q.priced_snapshot ->> 'notes' as notes,
             coalesce((
               select json_agg(json_build_object(
                        'id', ql.id, 'chargeName', ct.name_en, 'description', ql.description,
                        'basis', ql.basis, 'quantity', ql.quantity::text,
                        'rate', ql.rate::text, 'amount', ql.amount::text,
                        'currency', ql.currency) order by ql.sort_order)
                 from quote_lines ql
                 join charge_types ct on ct.id = ql.charge_type_id
                where ql.quote_id = q.id), '[]'::json) as lines,
             coalesce((
               select json_agg(json_build_object(
                        'id', h.id, 'reference', h.reference,
                        'version', h.version, 'status', h.status::text) order by h.version desc)
                 from quotes h
                where h.enquiry_id = q.enquiry_id and h.id <> q.id), '[]'::json) as history
        from quotes q
        join enquiries e on e.id = q.enquiry_id
        left join branches  b on b.id = q.branch_id
        left join customers c on c.id = e.customer_id
        left join principals p on p.id = q.prepared_by_id
        left join locations o on o.id = e.origin_id
        left join locations d on d.id = e.destination_id
       where q.id = ${id}
       limit 1
    `)
    return result.rows[0] as unknown as QuoteDetail | undefined
  })
}

export interface InvoiceDetail {
  readonly id: string
  readonly seriesNo: string | null
  readonly status: string
  readonly branchId: string
  readonly branchCode: string | null
  readonly customerId: string
  readonly customerName: string | null
  readonly currency: string
  readonly subtotal: string
  readonly taxAmount: string
  readonly total: string
  readonly amountPaid: string
  readonly taxTreatment: string
  readonly taxRatePercent: string
  readonly language: string
  readonly issuedAt: Date | null
  readonly dueOn: string | null
  readonly issuedBy: string | null
  readonly notes: string | null
  readonly lines: readonly {
    id: string
    descriptionEn: string
    quantity: string
    unitPrice: string
    amount: string
    taxAmount: string
  }[]
  readonly allocations: readonly {
    id: string
    amount: string
    receivedOn: string
    reference: string | null
    method: string
  }[]
}

export async function getInvoiceDetail(
  actor: Actor,
  id: string,
): Promise<InvoiceDetail | undefined> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select i.id, i.series_no as "seriesNo", i.status::text as status,
             i.branch_id as "branchId", b.code as "branchCode",
             i.customer_id as "customerId", c.legal_name_en as "customerName",
             i.currency, i.subtotal::text as subtotal, i.tax_amount::text as "taxAmount",
             i.total::text as total, i.amount_paid::text as "amountPaid",
             i.tax_treatment::text as "taxTreatment",
             i.tax_rate_percent::text as "taxRatePercent",
             i.language::text as language,
             i.issued_at as "issuedAt", i.due_on::text as "dueOn",
             p.name_en as "issuedBy", i.notes,
             coalesce((
               select json_agg(json_build_object(
                        'id', il.id, 'descriptionEn', il.description_en,
                        'quantity', il.quantity::text, 'unitPrice', il.unit_price::text,
                        'amount', il.amount::text, 'taxAmount', il.tax_amount::text)
                      order by il.sort_order)
                 from invoice_lines il where il.invoice_id = i.id), '[]'::json) as lines,
             coalesce((
               select json_agg(json_build_object(
                        'id', pa.id, 'amount', pa.amount::text,
                        'receivedOn', pm.received_on::text,
                        'reference', pm.reference, 'method', pm.method)
                      order by pm.received_on desc)
                 from payment_allocations pa
                 join payments pm on pm.id = pa.payment_id
                where pa.invoice_id = i.id), '[]'::json) as allocations
        from invoices i
        left join branches   b on b.id = i.branch_id
        left join customers  c on c.id = i.customer_id
        left join principals p on p.id = i.issued_by_id
       where i.id = ${id}
       limit 1
    `)
    return result.rows[0] as unknown as InvoiceDetail | undefined
  })
}
