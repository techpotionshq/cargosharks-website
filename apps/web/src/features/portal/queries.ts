/**
 * The customer portal's reads, `FR-CP-03`, `FR-CP-04`, `FR-CP-07`, `FR-CP-09`.
 *
 * The same tables and the same shapes as the operations board, run under a
 * different principal. A customer contact sees their own shipments because the
 * `customer_contact` arm of the RLS policy matches their `app.customer_id`
 * (§5.3) — not because this file filters anything. There is no `where
 * customer_id = ?` below, and its absence is the security property.
 *
 * What differs from the ops board is the *projection*: no owner, no margin, no
 * internal exception, no unreleased document. Those columns are not filtered
 * out of the response; they are never selected.
 */

import 'server-only'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  documentTypes,
  documents,
  jobMilestones,
  jobs,
  invoiceConversionDate,
  locations,
  systemActor,
  withActor,
  type Actor,
} from '@qabandi/db'
import { quoteConversionDate } from '@qabandi/core'
import type {
  Mode,
  PortalInvoice,
  PortalInvoiceDetail,
  PortalQuote,
  PortalQuoteDetail,
  PortalShipment,
} from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import {
  pilotPortalInvoice,
  pilotPortalInvoices,
  pilotPortalQuote,
  pilotPortalQuotes,
  pilotPortalShipments,
} from '@/lib/pilot/fixtures'
import { named } from '@/lib/named'
import { sumByCurrency, type CurrencyAmount } from '@/lib/by-currency'
import { countRows, pageOf, pageRequest, readPage, type Page, type PageRequest } from '@/lib/paging'
import { D } from '@qabandi/core'
import { isOverdue, portalQuoteState } from './status'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

/*
  Places and milestones are named in the reader's language. Every location and
  milestone carries an Arabic name, but `nullif` still falls back to English —
  an empty Arabic name is as unset as a null one.
*/
/** A customer's shipments: anything but a draft or a cancellation. */
const VISIBLE_JOB = and(isNull(jobs.cancelledAt), sql`${jobs.status} <> 'draft'`)

/**
 * The customer's shipments, a page at a time.
 *
 * This was `limit(50)` by ETA, over closed shipments as well as live ones, and
 * the tiles above it counted those fifty: a customer with two years of history
 * saw fifty shipments, "Active" among them only, and no way to the rest. The
 * tiles are `portalShipmentCounts` now.
 */
export async function listPortalShipments(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
  request: PageRequest = pageRequest(undefined),
): Promise<Page<PortalShipment>> {
  if (usePilotFixtures()) return pageOf(pilotPortalShipments(Date.now(), locale), request)

  const ar = locale === 'ar'

  return withActor(actor, (tx) =>
    readPage(
      request,
      async (limit, offset) => {
        const rows = await tx
          .select({
            id: jobs.id,
            reference: jobs.reference,
            customerReference: jobs.customerReference,
            status: jobs.status,
            mode: jobs.mode,
            eta: jobs.eta,
            originName: ar
              ? sql<string | null>`coalesce(nullif(${origin.nameAr}, ''), ${origin.nameEn})`
              : origin.nameEn,
            destinationName: ar
              ? sql<
                  string | null
                >`coalesce(nullif(${destination.nameAr}, ''), ${destination.nameEn})`
              : destination.nameEn,
            milestonesTotal: sql<number>`(
          select count(*)::int from ${jobMilestones}
           where ${jobMilestones.jobId} = "jobs"."id"
             and ${jobMilestones.customerVisible} = true
        )`,
            milestonesDone: sql<number>`(
          select count(*)::int from ${jobMilestones}
           where ${jobMilestones.jobId} = "jobs"."id"
             and ${jobMilestones.customerVisible} = true
             and ${jobMilestones.actualAt} is not null
        )`,
            // Released only. A draft on the job is not a customer document.
            documentsReleased: sql<number>`(
          select count(*)::int from ${documents}
           join ${documentTypes} on ${documentTypes.id} = ${documents.documentTypeId}
           where ${documents.jobId} = "jobs"."id"
             and ${documents.releasedAt} is not null
             and ${documents.supersededById} is null
             and ${documentTypes.isCustomerVisible} = true
        )`,
            nextMilestone: sql<string | null>`(
          select ${ar ? sql`coalesce(nullif(${jobMilestones.nameAr}, ''), ${jobMilestones.nameEn})` : jobMilestones.nameEn}
            from ${jobMilestones}
           where ${jobMilestones.jobId} = "jobs"."id"
             and ${jobMilestones.customerVisible} = true
             and ${jobMilestones.actualAt} is null
           order by ${jobMilestones.seq}
           limit 1
        )`,
          })
          .from(jobs)
          .leftJoin(origin, eq(origin.id, jobs.originId))
          .leftJoin(destination, eq(destination.id, jobs.destinationId))
          .where(VISIBLE_JOB)
          .orderBy(asc(jobs.eta), asc(jobs.id))
          .limit(limit)
          .offset(offset)

        return rows.map((row) => ({
          id: row.id,
          reference: row.reference,
          customerReference: row.customerReference,
          status: row.status,
          mode: row.mode as Mode,
          originName: row.originName ?? '—',
          destinationName: row.destinationName ?? '—',
          eta: row.eta,
          milestonesTotal: row.milestonesTotal,
          milestonesDone: row.milestonesDone,
          documentsReleased: row.documentsReleased,
          nextMilestone: row.nextMilestone,
        }))
      },
      () => countRows(tx, jobs, VISIBLE_JOB),
    ),
  )
}

/** Statuses a customer no longer counts as active. */
const FINISHED = ['completed', 'closed', 'cancelled']

/**
 * The portal home's three tiles, counted over every shipment the customer
 * may see rather than over the page of them below.
 */
export async function portalShipmentCounts(
  actor: Actor,
): Promise<{ active: number; arriving: number; documents: number }> {
  if (usePilotFixtures()) {
    const now = Date.now()
    const rows = pilotPortalShipments(now)
    return {
      active: rows.filter((s) => !FINISHED.includes(s.status)).length,
      arriving: rows.filter(
        (s) => s.eta !== null && s.eta.getTime() > now && s.eta.getTime() < now + 7 * 86_400_000,
      ).length,
      documents: rows.reduce((sum, s) => sum + s.documentsReleased, 0),
    }
  }

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        active: sql<number>`(count(*) filter (
          where ${jobs.status}::text not in ('completed', 'closed', 'cancelled')
        ))::int`,
        arriving: sql<number>`(count(*) filter (
          where ${jobs.eta} > now() and ${jobs.eta} < now() + interval '7 days'
        ))::int`,
        /*
          Released, current and customer-visible: what each row's own count
          shows. Written as qualified SQL rather than interpolated columns:
          with one table in the `from`, Drizzle prints a bare "id", which
          the subquery binds to the wrong table (check-boundaries rule 3).
        */
        documents: sql<number>`coalesce(sum((
          select count(*) from documents d
           join document_types dt on dt.id = d.document_type_id
           where d.job_id = "jobs"."id"
             and d.released_at is not null
             and d.superseded_by_id is null
             and dt.is_customer_visible = true
        )), 0)::int`,
      })
      .from(jobs)
      .where(VISIBLE_JOB)
    return {
      active: row?.active ?? 0,
      arriving: row?.arriving ?? 0,
      documents: row?.documents ?? 0,
    }
  })
}

// --- quotations and invoices (D12) -------------------------------------------

/*
  Two guards, and the order matters.

  RLS is the boundary: `quotes_customer_reads` and `invoices_customer_reads`
  give a customer contact only their own company's sent quotations and issued
  invoices, whatever this file asks for. The status filters below repeat that
  in the projection so the query says what it means, and so a reader of this
  file does not have to know the policy to know what a customer sees.

  The actor check is A9 again. The layout already sends staff and agents away
  from the portal, but these reads are exported, and staff RLS would hand a
  coordinator every quotation in their branches through a function named for
  a customer. A non-customer gets nothing rather than the wrong projection.
*/
const isCustomer = (actor: Actor): boolean => actor.type === 'customer_contact'

/** What a customer may hold: an offer that was sent, and is still the current version. */
const OFFERED = sql`q.status in ('sent', 'accepted', 'rejected', 'expired') and q.superseded_by_id is null`

/** Issued documents only, never a draft, an approved-but-unissued or a void invoice. */
const ISSUED = sql`i.status in ('issued', 'part_paid', 'paid', 'credited')`

function quoteColumns(locale: 'en' | 'ar') {
  return sql`
    q.id, q.reference, q.version, q.status::text as status, q.currency,
    q.total_sell::text as total, q.valid_until::text as "validUntil",
    q.sent_at as "sentAt", q.decided_at as "decidedAt", e.mode::text as mode,
    ${named(locale, sql`o.name_en`, sql`o.name_ar`)} as "originName",
    ${named(locale, sql`d.name_en`, sql`d.name_ar`)} as "destinationName"
  `
}

/** The customer's quotations, newest offer first. */
export async function listPortalQuotes(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
  request: PageRequest = pageRequest(undefined),
): Promise<Page<PortalQuote>> {
  if (usePilotFixtures()) return pageOf(pilotPortalQuotes(Date.now(), locale), request)
  if (!isCustomer(actor)) return pageOf([], request)

  // Paged with a count, where this was `limit 100` and the tiles counted it.
  return withActor(actor, (tx) =>
    readPage(
      request,
      async (limit, offset) => {
        const result = await tx.execute(sql`
          select ${quoteColumns(locale)}
            from quotes q
            join enquiries e on e.id = q.enquiry_id
            left join locations o on o.id = e.origin_id
            left join locations d on d.id = e.destination_id
           where ${OFFERED}
           order by coalesce(q.sent_at, q.created_at) desc, q.id desc
           limit ${limit} offset ${offset}
        `)
        return result.rows as unknown as PortalQuote[]
      },
      async () => {
        const result = await tx.execute(
          sql`select count(*)::int as n from quotes q where ${OFFERED}`,
        )
        return (result.rows[0] as { n: number } | undefined)?.n ?? 0
      },
    ),
  )
}

/**
 * The quotations page's two tiles, over every offer the customer holds.
 *
 * "Awaiting" is `portalQuoteState` = `sent`: sent, and not past its last valid
 * day in Kuwait (`today`), the rule the list badges each row by.
 */
export async function portalQuoteCounts(
  actor: Actor,
  today: string,
): Promise<{ awaiting: number; accepted: number }> {
  if (usePilotFixtures()) {
    const states = pilotPortalQuotes(Date.now()).map((q) => portalQuoteState(q, today))
    return {
      awaiting: states.filter((state) => state === 'sent').length,
      accepted: states.filter((state) => state === 'accepted').length,
    }
  }
  if (!isCustomer(actor)) return { awaiting: 0, accepted: 0 }

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select count(*) filter (
               where q.status = 'sent' and (q.valid_until is null or q.valid_until >= ${today}::date)
             )::int as awaiting,
             count(*) filter (where q.status = 'accepted')::int as accepted
        from quotes q
       where ${OFFERED}
    `)
    const row = result.rows[0] as { awaiting: number; accepted: number } | undefined
    return { awaiting: row?.awaiting ?? 0, accepted: row?.accepted ?? 0 }
  })
}

/** One quotation, or `undefined` for anything the customer may not hold. */
export async function getPortalQuote(
  actor: Actor,
  id: string,
  locale: 'en' | 'ar' = 'en',
): Promise<PortalQuoteDetail | undefined> {
  if (usePilotFixtures()) return pilotPortalQuote(id, Date.now(), locale)
  if (!isCustomer(actor)) return undefined

  const chargeName = named(locale, sql`ct.name_en`, sql`ct.name_ar`)
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select ${quoteColumns(locale)},
             e.reference as "enquiryReference", e.incoterm,
             ${named(locale, sql`b.legal_name_en`, sql`b.legal_name_ar`)} as "branchName",
             ${named(locale, sql`q.cover_note_en`, sql`q.cover_note_ar`)} as "coverNote",
             q.decision_note as "decisionNote",
             coalesce((
               select json_agg(json_build_object(
                        'id', ql.id, 'chargeName', ${chargeName}, 'description', ql.description,
                        'basis', ql.basis, 'quantity', ql.quantity::text,
                        'rate', ql.rate::text, 'amount', ql.amount::text,
                        'currency', ql.currency) order by ql.sort_order)
                 from quote_lines ql
                 join charge_types ct on ct.id = ql.charge_type_id
                where ql.quote_id = q.id), '[]'::json) as lines
        from quotes q
        join enquiries e on e.id = q.enquiry_id
        left join branches  b on b.id = q.branch_id
        left join locations o on o.id = e.origin_id
        left join locations d on d.id = e.destination_id
       where q.id = ${id} and ${OFFERED}
       limit 1
    `)
    const quote = result.rows[0] as unknown as PortalQuoteDetail | undefined
    if (!quote) return undefined
    /*
      Whether a line was converted, for the footnote. Read apart from the
      projection above and reduced to a date here, because the snapshot also
      holds our buy side and must never travel to the page whole.
    */
    const [frozen] = (
      await tx.execute(sql`select priced_snapshot as snapshot from quotes where id = ${id}`)
    ).rows as unknown as { snapshot: unknown }[]
    return { ...quote, convertedOn: quoteConversionDate(frozen?.snapshot, quote.currency) }
  })
}

function invoiceColumns() {
  /*
    What is owed, worked out by PostgreSQL in `numeric` and handed over as
    text, never a JS number, since the third decimal of a KWD balance does
    not survive a float. A credit note owes nothing; it is what reduced the
    balance of the invoice it names.
  */
  return sql`
    i.id, i.series_no as "seriesNo", i.status::text as status, i.currency,
    i.total::text as total, i.amount_paid::text as "amountPaid",
    i.amount_credited::text as "amountCredited",
    case when i.is_credit_note then '0'
         else (i.total - i.amount_paid - i.amount_credited)::text end as balance,
    i.issued_at as "issuedAt", i.due_on::text as "dueOn",
    i.is_credit_note as "isCreditNote", c.series_no as "creditsSeriesNo"
  `
}

/** The customer's issued invoices and credit notes, newest first. */
export async function listPortalInvoices(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
  request: PageRequest = pageRequest(undefined),
): Promise<Page<PortalInvoice>> {
  if (usePilotFixtures()) return pageOf(pilotPortalInvoices(Date.now(), locale), request)
  if (!isCustomer(actor)) return pageOf([], request)

  return withActor(actor, (tx) =>
    readPage(
      request,
      async (limit, offset) => {
        const result = await tx.execute(sql`
          select ${invoiceColumns()}
            from invoices i
            left join invoices c on c.id = i.credits_invoice_id
           where ${ISSUED}
           order by i.issued_at desc nulls last, i.series_no desc, i.id desc
           limit ${limit} offset ${offset}
        `)
        return result.rows as unknown as PortalInvoice[]
      },
      async () => {
        const result = await tx.execute(
          sql`select count(*)::int as n from invoices i where ${ISSUED}`,
        )
        return (result.rows[0] as { n: number } | undefined)?.n ?? 0
      },
    ),
  )
}

/**
 * What the customer owes, per currency, and how many invoices are overdue —
 * over every issued invoice, in SQL.
 *
 * Both tiles were worked out from the hundred newest invoices the list had
 * fetched, so an unpaid invoice older than the hundredth fell out of
 * "Outstanding" — money owed that the customer's own screen said was not. The
 * sum is `numeric` handed over as text, never a float; the overdue rule is
 * `isInvoiceOverdue` in core (owed states only, not a credit note), which
 * `isOverdue` in `status.ts` delegates to, written as SQL against `today`.
 */
export async function portalInvoiceSummary(
  actor: Actor,
  today: string,
): Promise<{ owing: readonly CurrencyAmount[]; overdue: number }> {
  if (usePilotFixtures()) {
    const invoices = pilotPortalInvoices(Date.now())
    return {
      owing: sumByCurrency(
        invoices
          .filter((invoice) => !invoice.isCreditNote)
          .map((invoice) => ({ currency: invoice.currency, amount: invoice.balance })),
      ).filter((entry) => new D(entry.amount).greaterThan(0)),
      overdue: invoices.filter((invoice) => isOverdue(invoice, today)).length,
    }
  }
  if (!isCustomer(actor)) return { owing: [], overdue: 0 }

  return withActor(actor, async (tx) => {
    const owing = await tx.execute(sql`
      select i.currency, sum(i.total - i.amount_paid - i.amount_credited)::text as amount
        from invoices i
       where ${ISSUED} and not i.is_credit_note
       group by i.currency
      having sum(i.total - i.amount_paid - i.amount_credited) > 0
       order by i.currency
    `)
    const overdue = await tx.execute(sql`
      select count(*)::int as n
        from invoices i
       where i.status in ('issued', 'part_paid')
         and not i.is_credit_note
         and i.due_on < ${today}::date
         and i.total - i.amount_paid - i.amount_credited > 0
    `)
    return {
      owing: (owing.rows as unknown as CurrencyAmount[]).map(({ currency, amount }) => ({
        currency,
        amount,
      })),
      overdue: (overdue.rows[0] as { n: number } | undefined)?.n ?? 0,
    }
  })
}

/** One issued invoice or credit note, or `undefined`. */
export async function getPortalInvoice(
  actor: Actor,
  id: string,
  locale: 'en' | 'ar' = 'en',
): Promise<PortalInvoiceDetail | undefined> {
  if (usePilotFixtures()) return pilotPortalInvoice(id, Date.now(), locale)
  if (!isCustomer(actor)) return undefined

  const invoice = await withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select ${invoiceColumns()},
             i.subtotal::text as subtotal, i.tax_amount::text as "taxAmount",
             i.credits_invoice_id as "creditsInvoiceId",
             ${named(locale, sql`b.legal_name_en`, sql`b.legal_name_ar`)} as "branchName",
             coalesce((
               select json_agg(json_build_object(
                        'id', il.id,
                        'description', ${named(locale, sql`il.description_en`, sql`il.description_ar`)},
                        'quantity', il.quantity::text, 'unitPrice', il.unit_price::text,
                        'amount', il.amount::text, 'taxAmount', il.tax_amount::text)
                      order by il.sort_order)
                 from invoice_lines il where il.invoice_id = i.id), '[]'::json) as lines,
             coalesce((
               select json_agg(json_build_object(
                        'id', n.id, 'seriesNo', n.series_no, 'total', n.total::text,
                        'issuedAt', n.issued_at)
                      order by n.issued_at desc)
                 from invoices n
                where n.credits_invoice_id = i.id and n.is_credit_note
                  and n.status in ('issued', 'part_paid', 'paid', 'credited')), '[]'::json)
               as "creditNotes"
        from invoices i
        left join invoices c on c.id = i.credits_invoice_id
        left join branches b on b.id = i.branch_id
       where i.id = ${id} and ${ISSUED}
       limit 1
    `)
    return result.rows[0] as unknown as PortalInvoiceDetail | undefined
  })
  if (!invoice) return undefined
  /*
    The conversion footnote, read with the system actor once the customer has
    been shown the invoice: the charge lines and quotation it is worked out
    from are ours, and only the date leaves (`invoiceConversionDate`).
  */
  const convertedOn = await withActor(systemActor(), (tx) => invoiceConversionDate(tx, id))
  return { ...invoice, convertedOn }
}
