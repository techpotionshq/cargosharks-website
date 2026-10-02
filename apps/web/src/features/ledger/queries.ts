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
 *
 * Each read has two implementations behind `usePilotFixtures()`: the seeded
 * pilot dataset, and the real tables. Same signature, same return type, and
 * the filters are applied on both sides — a demo where clicking a status tab
 * changes nothing reads as broken rather than as empty. See
 * `lib/pilot/source.ts` for why the switch is an environment variable rather
 * than a fork of these queries.
 */

import 'server-only'
import { asc, desc, eq, sql } from 'drizzle-orm'
import {
  accountingExports,
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
import { named } from '@/lib/named'
import type { CurrencyAmount } from '@/lib/by-currency'
import { usePilotFixtures } from '@/lib/pilot/source'
import {
  pilotAccountingExports,
  pilotHasQuotes,
  pilotInvoiceDetail,
  pilotInvoiceSummary,
  pilotInvoices,
  pilotPaymentSummary,
  pilotPayments,
  pilotQuoteDetail,
  pilotQuoteStatusCounts,
  pilotQuotes,
  pilotReceivablesAgeing,
  pilotTopDebtors,
} from '@/lib/pilot/fixtures'

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

/** `locale` names the customer in the reader's language (F27). */
export async function listQuotes(
  actor: Actor,
  status?: string,
  locale: 'en' | 'ar' = 'en',
): Promise<QuoteRow[]> {
  if (usePilotFixtures()) return pilotQuotes(Date.now(), status, locale)

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
        customerName: named(locale, customers.legalNameEn, customers.legalNameAr),
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
  if (usePilotFixtures()) return pilotQuoteStatusCounts()

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
  readonly amountCredited: string | null
  readonly issuedAt: Date | null
  readonly dueOn: string | null
  readonly isCreditNote: boolean
  readonly customerName: string | null
  readonly branchCode: string | null
}

/** `locale` names the customer in the reader's language (F27). */
export async function listInvoices(
  actor: Actor,
  status?: string,
  locale: 'en' | 'ar' = 'en',
): Promise<InvoiceRow[]> {
  if (usePilotFixtures()) return pilotInvoices(Date.now(), status, locale)

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
        amountCredited: invoices.amountCredited,
        issuedAt: invoices.issuedAt,
        dueOn: invoices.dueOn,
        isCreditNote: invoices.isCreditNote,
        customerName: named(locale, customers.legalNameEn, customers.legalNameAr),
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
 * One currency's share of the receivables position — `numeric` as text, summed
 * in SQL, never in JavaScript. The same shape every per-currency total on the
 * finance screens uses (`lib/by-currency.ts`).
 */
export type OutstandingByCurrency = CurrencyAmount

/**
 * The receivables position.
 *
 * `outstanding` is total minus paid across everything issued and not settled —
 * the number a finance manager opens the screen for — one entry per currency.
 * It used to be one sum over every invoice, labelled with the newest invoice's
 * currency: a KWD branch and an AED branch added dinars to dirhams and printed
 * the result as whichever was raised last. Amounts in different currencies do
 * not add, so the screen shows them side by side. Largest balance first, so
 * the currency most of the book is in leads; empty when nothing is owed.
 */
export async function invoiceSummary(actor: Actor): Promise<{
  issued: number
  paid: number
  overdue: number
  outstanding: readonly OutstandingByCurrency[]
}> {
  if (usePilotFixtures()) return pilotInvoiceSummary()

  return withActor(actor, async (tx) => {
    const counts = await tx.execute(sql`
      select
        count(*) filter (where status in ('issued', 'part_paid'))::int     as issued,
        count(*) filter (where status = 'paid')::int                         as paid,
        count(*) filter (where status in ('issued', 'part_paid')
                           and due_on < current_date)::int                   as overdue
      from invoices
    `)
    const row = counts.rows[0] as unknown as
      { issued: number; paid: number; overdue: number } | undefined

    /*
      Only issued and part-paid invoices are owed. A credited invoice was
      counted here (and in the ageing and top debtors below) as long as
      anything was left on it, while the credit exposure excluded it — three
      screens disagreeing about what a customer owes. An approved invoice has
      not been sent, so is not owed either.

      What is owed on one is its total less receipts and less any partial
      credit note (F9) — `amount_credited`, which a note for part of an
      invoice reduces without moving it out of these two states.

      Drafts are not owed: nothing has been sent. Counted here and not in
      "issued" beside it, a draft raised the receivables figure the moment it
      was created. A currency whose open invoices net to zero is left out
      rather than shown as "AED 0.00" beside the figures that matter.
    */
    const balances = await tx.execute(sql`
      select currency,
             sum(total - amount_paid - amount_credited)::text as amount
      from invoices
      where status in ('issued', 'part_paid')
      group by currency
      having sum(total - amount_paid - amount_credited) <> 0
      order by sum(total - amount_paid - amount_credited) desc, currency
    `)

    return {
      issued: row?.issued ?? 0,
      paid: row?.paid ?? 0,
      overdue: row?.overdue ?? 0,
      outstanding: (balances.rows as unknown as { currency: string; amount: string }[]).map(
        ({ currency, amount }) => ({ currency, amount }),
      ),
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

/** `locale` names the customer in the reader's language (F27). */
export async function listPayments(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
): Promise<PaymentRow[]> {
  if (usePilotFixtures()) return pilotPayments(Date.now(), locale)

  return withActor(actor, async (tx) =>
    tx
      .select({
        id: payments.id,
        amount: payments.amount,
        currency: payments.currency,
        receivedOn: payments.receivedOn,
        method: payments.method,
        reference: payments.reference,
        customerName: named(locale, customers.legalNameEn, customers.legalNameAr),
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

/**
 * The receipts position.
 *
 * `received` is one figure per currency, largest first. It used to be one sum
 * over every receipt labelled with the newest receipt's currency — the same
 * dinars-plus-dirhams figure `invoiceSummary` printed before F45. Still one
 * statement: the per-currency sums come back as a JSON array beside the
 * counts, with each amount cast to text before it is wrapped, so `numeric`
 * never passes through a JSON number on its way to the page.
 */
export async function paymentSummary(
  actor: Actor,
): Promise<{ count: number; received: readonly CurrencyAmount[]; unallocated: number }> {
  if (usePilotFixtures()) return pilotPaymentSummary()

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select
        count(*)::int as count,
        count(*) filter (where not exists (
          select 1 from payment_allocations pa where pa.payment_id = payments.id
        ))::int       as unallocated,
        coalesce((
          select json_agg(json_build_object('currency', r.currency, 'amount', r.amount)
                          order by r.total desc, r.currency)
            from (select currency, sum(amount) as total, sum(amount)::text as amount
                    from payments group by currency) r
        ), '[]'::json) as received
      from payments
    `)
    const row = result.rows[0] as unknown as
      { count: number; received: CurrencyAmount[] | null; unallocated: number } | undefined

    return {
      count: row?.count ?? 0,
      received: (row?.received ?? []).map(({ currency, amount }) => ({ currency, amount })),
      unallocated: row?.unallocated ?? 0,
    }
  })
}

/** Whether anything has ever been quoted — used by the empty states. */
export async function hasQuotes(actor: Actor): Promise<boolean> {
  if (usePilotFixtures()) return pilotHasQuotes()

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

/**
 * One currency's ageing — its buckets add up to its own `total`.
 *
 * `overdue` is everything past its due date, summed in the statement rather
 * than by adding four bucket strings together on the page.
 */
export interface CurrencyAgeing {
  readonly currency: string
  readonly buckets: AgeingBucket[]
  readonly total: string
  readonly overdue: string
}

/**
 * One ageing per currency, largest book first.
 *
 * It used to be one set of buckets summed across every open invoice and
 * labelled with the first invoice's currency — dinars and dirhams in one bar.
 * Grouped by currency now, so each bar is a proportion of money that adds.
 * Empty when nothing is owed.
 */
export async function receivablesAgeing(actor: Actor): Promise<{ byCurrency: CurrencyAgeing[] }> {
  if (usePilotFixtures()) return pilotReceivablesAgeing()

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      with open_invoices as (
        -- Less partial credit notes too (F9), as in the summary above.
        select due_on, currency, (total - amount_paid - amount_credited) as balance
          from invoices
         where status in ('issued', 'part_paid')
           and total > amount_paid + amount_credited
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
        coalesce(sum(balance) filter (where due_on < current_date), 0)::text as overdue,
        sum(balance)::text as total,
        currency
      from open_invoices
      group by currency
      order by sum(balance) desc, currency
    `)

    const rows = result.rows as Record<string, string | number | null>[]
    return {
      byCurrency: rows.map((row) => {
        const bucket = (key: AgeingBucket['key']): AgeingBucket => ({
          key,
          count: Number(row[`${key}_count`] ?? 0),
          amount: String(row[`${key}_amount`] ?? '0'),
        })
        return {
          currency: String(row.currency),
          buckets: [
            bucket('current'),
            bucket('d1_30'),
            bucket('d31_60'),
            bucket('d61_90'),
            bucket('d90_plus'),
          ],
          total: String(row.total ?? '0'),
          overdue: String(row.overdue ?? '0'),
        }
      }),
    }
  })
}

/**
 * Who owes the most, and how overdue the worst of it is.
 *
 * Ordered by balance rather than by how late it is: chasing the largest
 * exposure first is what a credit controller actually does, and the oldest
 * debt is frequently the smallest and the least collectable.
 *
 * One row per customer *and currency*. A customer owing dinars and dollars is
 * two rows, because the balance used to be the two added together and
 * labelled `max(currency)` — alphabetically, so "USD" — which printed a dinar
 * debt as dollars. The ranking compares face values across currencies, which
 * is imperfect without a rate, but it no longer changes any figure.
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

/** `locale` names the customer in the reader's language (F27). */
export async function topDebtors(
  actor: Actor,
  limit = 8,
  locale: 'en' | 'ar' = 'en',
): Promise<DebtorRow[]> {
  if (usePilotFixtures()) return pilotTopDebtors(Date.now(), limit, locale)

  const name = named(locale, sql`c.legal_name_en`, sql`c.legal_name_ar`)
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select c.id                                            as "customerId",
             ${name}                                         as "customerName",
             sum(i.total - i.amount_paid - i.amount_credited)::text as balance,
             i.currency                                      as currency,
             count(*)::int                                   as "invoiceCount",
             min(i.due_on)::text                             as "oldestDueOn",
             greatest(0, current_date - min(i.due_on))::int  as "daysOverdue"
        from invoices i
        join customers c on c.id = i.customer_id
       where i.status in ('issued', 'part_paid')
         and i.total > i.amount_paid + i.amount_credited
       group by c.id, c.legal_name_en, c.legal_name_ar, i.currency
       order by sum(i.total - i.amount_paid - i.amount_credited) desc, i.currency
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
  /** The covering note the model drafts and a coordinator edits — one per language. */
  readonly coverNoteEn: string | null
  readonly coverNoteAr: string | null
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

/**
 * `locale` names the customer, the lane's ports and each line's charge in the
 * reader's language (F27). The preparer is a person and keeps their name; the
 * line descriptions are free text somebody typed and stay as typed.
 */
export async function getQuoteDetail(
  actor: Actor,
  id: string,
  locale: 'en' | 'ar' = 'en',
): Promise<QuoteDetail | undefined> {
  // An unknown id comes back `undefined` on both sides, which the page turns
  // into a 404 — the same answer RLS gives for another branch's quotation.
  if (usePilotFixtures()) return pilotQuoteDetail(id, Date.now(), locale)

  const customerName = named(locale, sql`c.legal_name_en`, sql`c.legal_name_ar`)
  const originName = named(locale, sql`o.name_en`, sql`o.name_ar`)
  const destinationName = named(locale, sql`d.name_en`, sql`d.name_ar`)
  const chargeName = named(locale, sql`ct.name_en`, sql`ct.name_ar`)
  // The arrow points the way the line reads, as it does on the partner file.
  const arrow = locale === 'ar' ? ' ← ' : ' → '

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select q.id, q.reference, q.enquiry_id as "enquiryId", e.reference as "enquiryReference",
             q.branch_id as "branchId", b.code as "branchCode",
             e.customer_id as "customerId", ${customerName} as "customerName",
             q.version, q.status::text as status, q.currency,
             q.total_sell::text as "totalSell", q.total_cost::text as "totalCost",
             q.valid_until::text as "validUntil",
             p.name_en as "preparedBy",
             q.sent_at as "sentAt", q.decided_at as "decidedAt", q.created_at as "createdAt",
             case when o.name_en is null or d.name_en is null then null
                  else ${originName} || ${arrow}::text || ${destinationName} end as lane,
             e.mode::text as mode,
             q.priced_snapshot ->> 'notes' as notes,
             q.cover_note_en as "coverNoteEn", q.cover_note_ar as "coverNoteAr",
             coalesce((
               select json_agg(json_build_object(
                        'id', ql.id, 'chargeName', ${chargeName}, 'description', ql.description,
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
  /** Partial credit notes against it (F9); owed is total - paid - credited. */
  readonly amountCredited: string
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
  /** The credit notes raised against it, newest first — or, on a note, none. */
  readonly creditNotes: readonly {
    id: string
    seriesNo: string | null
    total: string
    issuedAt: string | null
  }[]
  readonly isCreditNote: boolean
  /** On a credit note, the invoice it credits. */
  readonly creditsInvoiceId: string | null
}

/** `locale` names the customer in the reader's language (F27). */
export async function getInvoiceDetail(
  actor: Actor,
  id: string,
  locale: 'en' | 'ar' = 'en',
): Promise<InvoiceDetail | undefined> {
  if (usePilotFixtures()) return pilotInvoiceDetail(id, Date.now(), locale)

  const customerName = named(locale, sql`c.legal_name_en`, sql`c.legal_name_ar`)
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select i.id, i.series_no as "seriesNo", i.status::text as status,
             i.branch_id as "branchId", b.code as "branchCode",
             i.customer_id as "customerId", ${customerName} as "customerName",
             i.currency, i.subtotal::text as subtotal, i.tax_amount::text as "taxAmount",
             i.total::text as total, i.amount_paid::text as "amountPaid",
             i.amount_credited::text as "amountCredited",
             i.is_credit_note as "isCreditNote", i.credits_invoice_id as "creditsInvoiceId",
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
                where pa.invoice_id = i.id), '[]'::json) as allocations,
             coalesce((
               select json_agg(json_build_object(
                        'id', n.id, 'seriesNo', n.series_no, 'total', n.total::text,
                        'issuedAt', n.issued_at::text)
                      order by n.issued_at desc)
                 from invoices n
                where n.credits_invoice_id = i.id and n.is_credit_note), '[]'::json) as "creditNotes"
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

export interface AccountingExportRow {
  readonly id: string
  readonly branchCode: string | null
  readonly format: string
  readonly periodFrom: string
  readonly periodTo: string
  readonly rowCount: number
  readonly status: string
  readonly postedAt: Date | null
  readonly postedBy: string | null
  readonly voidedAt: Date | null
  readonly voidReason: string | null
}

/**
 * The exports this desk has run — FR-FN-12.
 *
 * Written because the void existed and was unreachable. `createAccountingExport`
 * had a screen; `voidAccountingExportAction` was implemented, tested against
 * the real service route, and called by nothing — so an export posted against
 * the wrong period consumed it permanently, and the only remedy was a
 * developer with a database connection.
 *
 * Voided rows stay in the list. That is the point of a void rather than a
 * delete: the reason someone gives for unwinding a posted period is a thing an
 * auditor asks about, and a list that hid them would answer "that export never
 * happened" (§5.5).
 */
export async function listAccountingExports(
  actor: Actor,
  limit = 12,
): Promise<AccountingExportRow[]> {
  // Sliced rather than passed on: the builder takes no limit, and `limit` here
  // is the SQL `limit` — honouring it keeps the two modes the same shape.
  if (usePilotFixtures()) return pilotAccountingExports().slice(0, limit)

  return withActor(actor, async (tx) =>
    tx
      .select({
        id: accountingExports.id,
        branchCode: branches.code,
        format: accountingExports.format,
        periodFrom: accountingExports.periodFrom,
        periodTo: accountingExports.periodTo,
        rowCount: accountingExports.rowCount,
        status: accountingExports.status,
        postedAt: accountingExports.postedAt,
        postedBy: principals.nameEn,
        voidedAt: accountingExports.voidedAt,
        voidReason: accountingExports.voidReason,
      })
      .from(accountingExports)
      .leftJoin(branches, eq(branches.id, accountingExports.branchId))
      .leftJoin(principals, eq(principals.id, accountingExports.postedById))
      /*
        Newest first, and by when the period was *posted* rather than by the
        period itself: closing January in March puts it at the top, which is
        where somebody looking for the export they just ran expects it.
      */
      .orderBy(desc(accountingExports.createdAt))
      .limit(limit),
  )
}
