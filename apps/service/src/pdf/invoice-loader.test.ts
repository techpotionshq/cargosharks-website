/**
 * Loading an invoice for print — the half `invoice.test.ts` cannot reach.
 *
 * The template is a pure function of a view and is tested as one. This is the
 * piece that builds the view, and it is the piece where an invoice can be
 * quietly wrong: a total that does not match the lines under it, or the lines
 * in a different order from the copy the customer is holding.
 *
 * **Nothing is recomputed here.** `subtotal`, `tax_amount` and `total` are read
 * off the invoice as stored, never derived from the lines. The invoice is the
 * record — the engine that produced those figures ran once, at issue, against
 * charge lines that may since have been re-costed — and a document that
 * re-adds them is a document that can disagree with the ledger.
 *
 * **A draft prints too, and says so.** An unissued invoice has no series
 * number, so it is named by id and watermarked. Refusing to render one would
 * take away the only way to check an invoice before sending it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const printer = vi.hoisted(() => ({
  calls: [] as { html: string; locale: string }[],
}))

vi.mock('./renderer', () => ({
  createRenderer: () => ({
    render: async (request: { html: string; locale: string }) => {
      printer.calls.push({ html: request.html, locale: request.locale })
      return Buffer.from(`%PDF-1.7 ${request.html.length}`)
    },
    close: async () => {},
  }),
}))

const { branches, customers, invoiceLines, invoices, principals, withActor, workingCalendars } =
  await import('@qabandi/db')

const { loadInvoiceView, renderInvoicePdf, DocumentNotFoundError } = await import('./documents')

const BRANCH = '00000000-0000-7000-8000-00000000dc01'
const CUSTOMER = '00000000-0000-7000-8000-00000000dc02'
const PRINCIPAL = '00000000-0000-7000-8000-00000000dc03'
const ABSENT = '00000000-0000-7000-8000-00000000dc00'

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/**
 * Issued unless told otherwise, because that is the interesting case and
 * `invoices_series_when_issued` will not let a draft carry a series number.
 */
async function invoice(over: Record<string, unknown> = {}): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(invoices)
      .values({
        branchId: BRANCH,
        customerId: CUSTOMER,
        status: 'issued',
        seriesNo: `INV-${RUN}-${seq}`,
        currency: 'KWD',
        subtotal: '250.000',
        taxAmount: '0.000',
        total: '250.000',
        issuedAt: new Date('2026-06-02T07:30:00Z'),
        dueOn: '2026-07-02',
        ...over,
      })
      .returning({ id: invoices.id })
    return row!.id
  })
}

const line = (invoiceId: string, values: Record<string, unknown>) =>
  withActor(systemActor, (tx) =>
    tx.insert(invoiceLines).values({
      invoiceId,
      descriptionEn: 'Ocean freight',
      quantity: '1',
      unitPrice: '250.000',
      amount: '250.000',
      ...values,
    } as never),
  )

describe.skipIf(!enabled)('loading an invoice for print', () => {
  beforeAll(async () => {
    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'invoice-print@qabandi.test',
          nameEn: 'Invoice Print Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'DCP',
          legalNameEn: 'Invoice Print Branch Co.',
          legalNameAr: 'فرع طباعة الفواتير',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'DCP',
          taxRegistration: 'KW-TRN-DCP',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-INVOICE-PRINT',
          legalNameEn: 'Invoice Print Customer',
          legalNameAr: 'عميل طباعة الفواتير',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()
    })
  })

  afterAll(async () => {
    // Marked paid, so no ageing sweep or reminder run picks them up.
    if (!enabled) return
    await withActor(systemActor, (tx) =>
      tx
        .update(invoices)
        .set({ status: 'paid', amountPaid: '250.000' })
        // `invoices_series_when_issued` refuses a settled invoice with no
        // series number, so the drafts stay drafts.
        .where(and(eq(invoices.branchId, BRANCH), isNotNull(invoices.seriesNo))),
    )
  })

  beforeEach(() => {
    printer.calls.length = 0
  })

  describe('the view', () => {
    /**
     * Not found rather than forbidden — FR-ID-04. Reporting a permission error
     * would confirm the invoice exists, which is the enumeration signal the
     * policy design is built to avoid.
     */
    it('refuses an invoice it cannot see, and names it in the log', async () => {
      await expect(loadInvoiceView(actor, ABSENT)).rejects.toBeInstanceOf(DocumentNotFoundError)
      await expect(loadInvoiceView(actor, ABSENT)).rejects.toThrow(`No invoice ${ABSENT}`)
    })

    it('carries the invoice, the customer and the issuing entity', async () => {
      const id = await invoice({ notes: 'Payable within 30 days' })

      const view = await loadInvoiceView(actor, id)

      expect(view.seriesNo).toBe(`INV-${RUN}-${seq}`)
      expect(view.currency).toBe('KWD')
      expect(view.dueOn).toBe('2026-07-02')
      expect(view.notes).toBe('Payable within 30 days')
      expect(view.customer.nameEn).toBe('Invoice Print Customer')
      expect(view.customer.nameAr).toBe('عميل طباعة الفواتير')
      // Five legal entities, five letterheads (FR-ID-01) — the invoice is
      // issued by a branch, and the registration on it has to be that one's.
      expect(view.branch.legalNameEn).toBe('Invoice Print Branch Co.')
      expect(view.branch.taxRegistration).toBe('KW-TRN-DCP')
    })

    /**
     * Read, never re-added. The engine that produced these ran once against
     * charge lines that may since have been re-costed, and a document that
     * recomputes them is a document free to disagree with the ledger.
     */
    it('states the totals as the invoice stored them', async () => {
      const id = await invoice({
        subtotal: '1000.000',
        taxAmount: '50.000',
        total: '1050.000',
        amountPaid: '250.000',
      })
      // Deliberately inconsistent with the header, which the view must not fix.
      await line(id, { amount: '1.000', unitPrice: '1.000' })

      const view = await loadInvoiceView(actor, id)

      expect(Number(view.subtotal)).toBeCloseTo(1000, 3)
      expect(Number(view.taxAmount)).toBeCloseTo(50, 3)
      expect(Number(view.total)).toBeCloseTo(1050, 3)
      expect(Number(view.amountPaid)).toBeCloseTo(250, 3)
    })

    /**
     * The order the operator put them in. Without an `order by` the rows come
     * back in whatever order the scan produced — stable enough to look
     * deliberate, and it changes the moment one is updated. An invoice
     * reprinted for a query then disagrees with the copy the customer holds,
     * and the call that follows is about which one is real.
     */
    it('lists the lines in the order they were entered', async () => {
      const id = await invoice()
      await line(id, { descriptionEn: 'Third', sortOrder: 3 })
      await line(id, { descriptionEn: 'First', sortOrder: 1 })
      await line(id, { descriptionEn: 'Second', sortOrder: 2 })

      const view = await loadInvoiceView(actor, id)

      expect(view.lines.map((l) => l.descriptionEn)).toEqual(['First', 'Second', 'Third'])
    })

    it('keeps the order after a line is edited', async () => {
      const id = await invoice()
      await line(id, { descriptionEn: 'Alpha', sortOrder: 1 })
      await line(id, { descriptionEn: 'Beta', sortOrder: 2 })

      // An update rewrites the row, which is what moves it in a heap scan.
      await withActor(systemActor, (tx) =>
        tx
          .update(invoiceLines)
          .set({ unitPrice: '99.000', amount: '99.000' })
          .where(eq(invoiceLines.invoiceId, id)),
      )

      const view = await loadInvoiceView(actor, id)

      expect(view.lines.map((l) => l.descriptionEn)).toEqual(['Alpha', 'Beta'])
    })

    it('carries both descriptions and the tax on each line', async () => {
      const id = await invoice()
      await line(id, {
        descriptionEn: 'Terminal handling',
        descriptionAr: 'مناولة أرضية',
        quantity: '2',
        unitPrice: '30.000',
        amount: '60.000',
        taxAmount: '3.000',
        isTaxable: true,
      })

      const [only] = (await loadInvoiceView(actor, id)).lines

      expect(only?.descriptionAr).toBe('مناولة أرضية')
      expect(Number(only?.quantity)).toBeCloseTo(2, 3)
      expect(Number(only?.taxAmount)).toBeCloseTo(3, 3)
    })

    /** A shell invoice is still an invoice; it prints with an empty table. */
    it('renders an invoice that has no lines yet', async () => {
      expect((await loadInvoiceView(actor, await invoice())).lines).toEqual([])
    })
  })

  describe('the rendered file', () => {
    /** The series number, because that is what finance files it under. */
    it('names the file for the series the invoice was issued under', async () => {
      const id = await invoice()

      const result = await renderInvoicePdf(actor, id, 'en')

      expect(result.filename).toBe(`INV-${RUN}-${seq}-en.pdf`)
      expect(result.pdf.subarray(0, 5).toString()).toBe('%PDF-')
    })

    /**
     * A draft has no series number — `invoices_series_when_issued` forbids one
     * — so it is named by id and watermarked. Refusing to render it would take
     * away the only way to check an invoice before it is sent.
     */
    it('names a draft by its id and marks it on the face', async () => {
      const id = await invoice({ status: 'draft', seriesNo: null, issuedAt: null })

      const result = await renderInvoicePdf(actor, id, 'en')

      expect(result.filename).toBe(`draft-${id.slice(0, 8)}-en.pdf`)
      expect(printer.calls[0]?.html).toContain('DRAFT')
    })

    /** The locale reaches Chromium, so `Intl` inside the page agrees with it. */
    it('renders in Arabic and says so in the filename', async () => {
      const id = await invoice()

      const result = await renderInvoicePdf(actor, id, 'ar')

      expect(result.filename).toMatch(/-ar\.pdf$/)
      expect(printer.calls[0]?.locale).toBe('ar')
      expect(printer.calls[0]?.html).toContain('dir="rtl"')
    })

    it('refuses to render an invoice it cannot see', async () => {
      await expect(renderInvoicePdf(actor, ABSENT, 'en')).rejects.toBeInstanceOf(
        DocumentNotFoundError,
      )
      expect(printer.calls).toEqual([])
    })
  })
})
