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
import { branches, customers, invoiceLines, invoices, withActor, type Actor } from '@qabandi/db'
import { renderInvoiceHtml, type DocumentLocale, type InvoiceView } from './invoice'
import { createRenderer } from './renderer'

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
