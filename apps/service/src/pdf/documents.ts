/**
 * Loading a document's data — the half between the database and the template.
 *
 * Separate from both, because the template must stay a pure function of its
 * view (so it can be rendered in a test without a database) and the renderer
 * must stay a pure function of HTML (so it never learns what an invoice is).
 * This is the only piece that knows both.
 *
 * Everything runs under `withActor`, so a document is subject to exactly the
 * same row-level security as the screen it was requested from. An invoice a
 * principal cannot see is a document they cannot render — enforced by the
 * database rather than by a check here that somebody could forget.
 */

import { asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  branches,
  chargeTypes,
  customers,
  enquiries,
  invoiceLines,
  invoices,
  locations,
  principals,
  quoteLines,
  quotes,
  withActor,
  type Actor,
} from '@qabandi/db'
import { renderInvoiceHtml, type DocumentLocale, type InvoiceView } from './invoice'
import { renderQuotationHtml, type QuotationView } from './quotation'
import { createRenderer } from './renderer'

/*
  The lane is two rows of the same table, so each end needs its own alias.

  Without them Drizzle emits one `locations` join for both columns and the
  origin silently becomes the destination — a quotation that reads
  "Shuwaikh → Shuwaikh" and is otherwise perfect.
*/
const origin = alias(locations, 'quote_origin')
const destination = alias(locations, 'quote_destination')

/**
 * Nothing here to render for this principal.
 *
 * `subject` because this is thrown for jobs and consolidations as much as for
 * invoices, and the message is what a support engineer reads while looking at
 * a bare 404 in a log. "No invoice 0f3a… visible to this principal" against a
 * request for a bill of lading sends them to the wrong table.
 */
export class DocumentNotFoundError extends Error {
  constructor(id: string, subject = 'document') {
    super(`No ${subject} ${id} visible to this principal`)
    this.name = 'DocumentNotFoundError'
  }
}

export async function loadInvoiceView(actor: Actor, invoiceId: string): Promise<InvoiceView> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        seriesNo: invoices.seriesNo,
        issuedAt: invoices.issuedAt,
        dueOn: invoices.dueOn,
        currency: invoices.currency,
        subtotal: invoices.subtotal,
        taxAmount: invoices.taxAmount,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        notes: invoices.notes,
        customerEn: customers.legalNameEn,
        customerAr: customers.legalNameAr,
        branchEn: branches.legalNameEn,
        branchAr: branches.legalNameAr,
        taxRegistration: branches.taxRegistration,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .innerJoin(branches, eq(branches.id, invoices.branchId))
      .where(eq(invoices.id, invoiceId))
      .limit(1)

    /*
      Not found rather than forbidden — FR-ID-04.

      RLS makes an invoice outside the principal's branches invisible rather
      than refused, so this is genuinely "no such row" from where the query
      stands. Reporting it as a permission error would leak that the invoice
      exists, which is the enumeration signal the policy design avoids.
    */
    if (!row) throw new DocumentNotFoundError(invoiceId, 'invoice')

    const lines = await tx
      .select({
        descriptionEn: invoiceLines.descriptionEn,
        descriptionAr: invoiceLines.descriptionAr,
        quantity: invoiceLines.quantity,
        unitPrice: invoiceLines.unitPrice,
        amount: invoiceLines.amount,
        taxAmount: invoiceLines.taxAmount,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId))
      /*
        The order the operator put them in, not the order the heap returns.

        Without this the lines come back in whatever order the scan produced,
        which is stable enough to look deliberate and changes the moment a row
        is updated. An invoice reprinted for a query then has its lines in a
        different order from the copy the customer is holding, and the call
        that follows is about which one is real. `sort_order` exists for this
        and `invoice_lines_invoice_idx` already leads with it.
      */
      .orderBy(asc(invoiceLines.sortOrder))

    return {
      seriesNo: row.seriesNo,
      issuedAt: row.issuedAt,
      dueOn: row.dueOn,
      currency: row.currency,
      subtotal: row.subtotal,
      taxAmount: row.taxAmount,
      total: row.total,
      amountPaid: row.amountPaid,
      notes: row.notes,
      customer: { nameEn: row.customerEn, nameAr: row.customerAr },
      branch: {
        legalNameEn: row.branchEn,
        legalNameAr: row.branchAr,
        taxRegistration: row.taxRegistration,
      },
      lines,
    }
  })
}

/**
 * A rendered invoice, and the filename it should be saved under.
 *
 * Generated on demand and streamed rather than stored. That is a deliberate
 * consequence of `FileStore` having no implementation yet — but it is also the
 * better default: an invoice PDF is a *view* of rows that can still change
 * before issue, and a stored copy would go stale the moment a line was edited.
 * Once storage exists, the copy worth keeping is the one made at issue, when
 * the document stops being a view and becomes a record.
 */
export async function renderInvoicePdf(
  actor: Actor,
  invoiceId: string,
  locale: DocumentLocale,
): Promise<{ pdf: Buffer; filename: string }> {
  const view = await loadInvoiceView(actor, invoiceId)
  const renderer = createRenderer()

  const pdf = await renderer.render({
    html: renderInvoiceHtml(view, locale),
    locale,
  })

  // The series number, because that is what finance files it under. A draft
  // has none, so it is named by id and marked draft on its face.
  const stem = view.seriesNo ?? `draft-${invoiceId.slice(0, 8)}`

  return { pdf, filename: `${stem}-${locale}.pdf` }
}

/**
 * A quotation, assembled from the quote, its enquiry and the branch.
 *
 * The enquiry is joined rather than copied onto the quote because the lane,
 * mode and Incoterm are the *enquiry's* facts — a revision quotes the same
 * shipment at a new price, and duplicating them onto every version is four
 * chances for the third revision to describe a different journey.
 *
 * Buy-side figures are absent by construction. `total_cost` is on the row
 * right beside `total_sell` and is deliberately not selected: the margin
 * belongs to the internal comparison screen (FR-EQ-07), and a loader that
 * never reads it cannot leak it into a customer's document.
 */
export async function loadQuotationView(actor: Actor, quoteId: string): Promise<QuotationView> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        reference: quotes.reference,
        version: quotes.version,
        status: quotes.status,
        currency: quotes.currency,
        totalSell: quotes.totalSell,
        validUntil: quotes.validUntil,
        sentAt: quotes.sentAt,
        createdAt: quotes.createdAt,
        pricedSnapshot: quotes.pricedSnapshot,
        preparedBy: principals.nameEn,
        enquiryReference: enquiries.reference,
        mode: enquiries.mode,
        incoterm: enquiries.incoterm,
        originEn: origin.nameEn,
        originAr: origin.nameAr,
        destinationEn: destination.nameEn,
        destinationAr: destination.nameAr,
        customerEn: customers.legalNameEn,
        customerAr: customers.legalNameAr,
        branchEn: branches.legalNameEn,
        branchAr: branches.legalNameAr,
        taxRegistration: branches.taxRegistration,
        tradingConditionsEn: branches.tradingConditionsEn,
        tradingConditionsAr: branches.tradingConditionsAr,
      })
      .from(quotes)
      .innerJoin(enquiries, eq(enquiries.id, quotes.enquiryId))
      .innerJoin(branches, eq(branches.id, quotes.branchId))
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .leftJoin(principals, eq(principals.id, quotes.preparedById))
      .leftJoin(origin, eq(origin.id, enquiries.originId))
      .leftJoin(destination, eq(destination.id, enquiries.destinationId))
      .where(eq(quotes.id, quoteId))
      .limit(1)

    // Invisible rather than forbidden, exactly as for the invoice above.
    if (!row) throw new DocumentNotFoundError(quoteId, 'quotation')

    const lines = await tx
      .select({
        chargeNameEn: chargeTypes.nameEn,
        chargeNameAr: chargeTypes.nameAr,
        description: quoteLines.description,
        basis: quoteLines.basis,
        quantity: quoteLines.quantity,
        rate: quoteLines.rate,
        amount: quoteLines.amount,
      })
      .from(quoteLines)
      .innerJoin(chargeTypes, eq(chargeTypes.id, quoteLines.chargeTypeId))
      .where(eq(quoteLines.quoteId, quoteId))
      // The order the pricing put them in — see the invoice loader.
      .orderBy(asc(quoteLines.sortOrder))

    /*
      Inclusions, exclusions and notes come out of `priced_snapshot`.

      They belong with the pricing decision rather than beside it: a quotation
      is never edited (FR-RT-08 — a revision is a new row), and the snapshot is
      already the thing that freezes what was offered. Putting them in columns
      would create a second place a revision has to remember to copy, and the
      first one somebody forgets is the exclusion that decides who pays for the
      customs examination.
    */
    const snapshot = (row.pricedSnapshot ?? {}) as Record<string, unknown>
    const list = (key: string): readonly string[] => {
      const value = snapshot[key]
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
    }

    return {
      reference: row.reference,
      version: row.version,
      status: row.status,
      currency: row.currency,
      total: row.totalSell,
      validUntil: row.validUntil,
      preparedBy: row.preparedBy,
      /*
        Dated by when it was sent, and only falling back to when it was made.

        A quotation reprinted in June must carry the date the customer was
        given it, not today's — that date is what the validity was counted
        from, and a reprint that redates itself silently extends an offer that
        has already lapsed.
      */
      issuedAt: row.sentAt ?? row.createdAt,
      customer: {
        nameEn: row.customerEn ?? '',
        nameAr: row.customerAr,
      },
      enquiryReference: row.enquiryReference,
      mode: row.mode,
      incoterm: row.incoterm,
      originEn: row.originEn,
      destinationEn: row.destinationEn,
      originAr: row.originAr,
      destinationAr: row.destinationAr,
      transitDays: typeof snapshot.transitDays === 'number' ? snapshot.transitDays : null,
      notes: typeof snapshot.notes === 'string' ? snapshot.notes : null,
      inclusions: list('inclusions'),
      exclusions: list('exclusions'),
      branch: {
        legalNameEn: row.branchEn,
        legalNameAr: row.branchAr,
        taxRegistration: row.taxRegistration,
      },
      tradingConditionsEn: row.tradingConditionsEn,
      tradingConditionsAr: row.tradingConditionsAr,
      lines,
    }
  })
}

/**
 * A rendered quotation, and the filename it should be saved under.
 *
 * Streamed rather than stored, on the same reasoning as the invoice — and more
 * strongly here. A quotation is already immutable in the record: FR-RT-08
 * makes a revision a new row with the previous one marked superseded, so the
 * quote *is* the archive and a stored PDF beside it would be a second copy
 * with nothing to reconcile it against.
 */
export async function renderQuotationPdf(
  actor: Actor,
  quoteId: string,
  locale: DocumentLocale,
): Promise<{ pdf: Buffer; filename: string }> {
  const view = await loadQuotationView(actor, quoteId)
  const renderer = createRenderer()

  const pdf = await renderer.render({
    html: renderQuotationHtml(view, locale),
    locale,
  })

  // The reference, because that is what the customer quotes back on the phone.
  // Revisions carry their version, so v1 and v2 do not overwrite each other in
  // the recipient's downloads folder.
  const stem = view.version > 1 ? `${view.reference}-v${view.version}` : view.reference

  return { pdf, filename: `${stem}-${locale}.pdf` }
}
