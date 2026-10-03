/**
 * The invoice template.
 *
 * A pure function of its view, which is why it is worth testing here rather
 * than through a rendered PDF: the things that go wrong on an invoice are
 * arithmetic, precision and escaping, and none of them need a browser to
 * check. The browser's job — Arabic shaping and mirroring — is Chromium's and
 * is verified by looking at the output, not by asserting on markup.
 */

import { describe, expect, it } from 'vitest'
import { renderInvoiceHtml, type InvoiceView } from './invoice'

const base: InvoiceView = {
  seriesNo: 'KWI-INV-2026-00005',
  issuedAt: new Date('2026-07-14T09:00:00Z'),
  dueOn: '2026-08-13',
  currency: 'KWD',
  subtotal: '8515.000000',
  taxAmount: '425.500000',
  total: '8940.500000',
  amountPaid: '0',
  notes: null,
  customer: { nameEn: 'Sabahiya Petroleum', nameAr: 'شركة الصباحية للبترول' },
  branch: {
    legalNameEn: 'Al-Qabandi Kuwait',
    legalNameAr: 'القبندي الكويت',
    taxRegistration: 'KW-TRN-4471',
  },
  lines: [
    {
      descriptionEn: 'Ocean freight',
      descriptionAr: 'أجرة الشحن البحري',
      quantity: '1',
      unitPrice: '2838.330000',
      amount: '2838.330000',
      taxAmount: '0',
    },
  ],
}

const view = (patch: Partial<InvoiceView>): InvoiceView => ({ ...base, ...patch })

describe('invoice document', () => {
  /**
   * The most expensive regression available in this codebase, stated as a
   * test: KWD carries three decimals, and a two-decimal format corrupts every
   * Kuwaiti amount while still looking like money.
   */
  it('renders KWD to three decimal places', () => {
    const html = renderInvoiceHtml(base, 'en')
    expect(html).toContain('8,940.500')
    expect(html).not.toMatch(/8,940\.50(?!\d)/)
  })

  /** And takes the scale from the currency rather than a constant. */
  it('renders a two-decimal currency to two places', () => {
    const html = renderInvoiceHtml(
      view({ currency: 'AED', total: '8940.500000', subtotal: '8940.500000', taxAmount: '0' }),
      'en',
    )
    expect(html).toContain('8,940.50')
  })

  /**
   * Arabic conventions, Latin digits — the `-u-nu-latn` decision from
   * `lib/format.ts`. Eastern Arabic numerals are unreadable to half the office
   * and unparseable by everything downstream.
   */
  it('uses Latin digits in the Arabic document', () => {
    const html = renderInvoiceHtml(base, 'ar')
    expect(html).toContain('8,940.500')
    expect(html).not.toMatch(/[٠-٩]/)
  })

  it('sets the direction and language for Arabic', () => {
    expect(renderInvoiceHtml(base, 'ar')).toContain('<html lang="ar" dir="rtl"')
    expect(renderInvoiceHtml(base, 'en')).toContain('<html lang="en" dir="ltr"')
  })

  /**
   * A document is printed, and paper has no colour scheme.
   *
   * The brand stylesheet carries dark values under `prefers-color-scheme`, so
   * without the pin an invoice rendered on a machine reporting a dark scheme
   * would print white type on a near-black A4 page — and the first anyone
   * would know is a customer's toner. See `pdf/brand.ts`.
   */
  it('pins the document to the light theme, and takes its colours from the brand', () => {
    const html = renderInvoiceHtml(base, 'en')
    expect(html).toContain('data-theme="light"')
    expect(html).toContain('--qb-brand:')
    // The bug this replaced: a former default brand's maroon, on every invoice.
    expect(html).not.toContain('#8c1d18')
  })

  it('prefers the Arabic name where one exists', () => {
    const html = renderInvoiceHtml(base, 'ar')
    expect(html).toContain('شركة الصباحية للبترول')
    expect(html).toContain('أجرة الشحن البحري')
  })

  /**
   * A missing Arabic description falls back rather than rendering blank.
   *
   * `description_ar` is nullable and the demo data leaves it null, so an
   * Arabic invoice with an empty line column is the likely failure — an empty
   * cell reads as a missing charge, which is worse than an untranslated one.
   */
  it('falls back to English when the Arabic description is missing', () => {
    const html = renderInvoiceHtml(
      view({ lines: [{ ...base.lines[0]!, descriptionAr: null }] }),
      'ar',
    )
    expect(html).toContain('Ocean freight')
  })

  /**
   * Escaping, and the reason it is not paranoia.
   *
   * Names and descriptions are operator-entered and reach Chromium as markup.
   * An ampersand in a legal name would break the document; a script tag would
   * execute inside a browser process in our own container.
   */
  it('escapes operator-entered text', () => {
    const html = renderInvoiceHtml(
      view({
        customer: { nameEn: 'Smith & Sons <script>alert(1)</script>', nameAr: null },
      }),
      'en',
    )
    expect(html).toContain('Smith &amp; Sons')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  /**
   * A draft is watermarked, never refused.
   *
   * `series_no` is null until the branch's statutory sequence assigns one, and
   * a draft must not be mistakable for something a customer can pay against.
   */
  it('watermarks an unissued invoice', () => {
    expect(renderInvoiceHtml(view({ seriesNo: null }), 'en')).toContain('DRAFT')
    expect(renderInvoiceHtml(base, 'en')).not.toContain('DRAFT')
  })

  /** The balance line appears only once something has been received. */
  it('shows a balance only when part paid', () => {
    expect(renderInvoiceHtml(base, 'en')).not.toContain('Balance due')

    const partPaid = renderInvoiceHtml(view({ amountPaid: '5000.000000' }), 'en')
    expect(partPaid).toContain('Balance due')
    expect(partPaid).toContain('3,940.500')
  })

  /** F9. A partial credit note is a line of its own, never folded into "Received". */
  it('shows what was credited apart from what was received', () => {
    const html = renderInvoiceHtml(
      view({ amountPaid: '5000.000000', amountCredited: '940.500000' }),
      'en',
    )
    expect(html).toContain('Credited')
    expect(html).toContain('940.500')
    expect(html).toContain('3,000.000')
    expect(renderInvoiceHtml(view({ amountCredited: '1.000' }), 'ar')).toContain('إشعارات دائنة')
  })

  it('shows the issuing entity and its tax registration', () => {
    const html = renderInvoiceHtml(base, 'en')
    expect(html).toContain('Al-Qabandi Kuwait')
    expect(html).toContain('KW-TRN-4471')
  })

  it('omits the tax registration line when the entity has none', () => {
    const html = renderInvoiceHtml(
      view({ branch: { ...base.branch, taxRegistration: null } }),
      'en',
    )
    expect(html).not.toContain('Tax registration')
  })

  it('says a job-billed note in the document’s language, whoever drafted it (NEW-6)', () => {
    const billed = view({ notes: 'Billed from KWI-JOB-2026-00001' })
    expect(renderInvoiceHtml(billed, 'ar')).toContain('مفوترة من')
    expect(renderInvoiceHtml(billed, 'ar')).not.toContain('Billed from')
    expect(renderInvoiceHtml(billed, 'en')).toContain('Billed from')
    // An Arabic draft's stored note reads in English on the English copy.
    expect(renderInvoiceHtml(view({ notes: 'مفوترة من KWI-JOB-2026-00001' }), 'en')).toContain(
      'Billed from',
    )
    // A note a person typed prints as typed.
    expect(renderInvoiceHtml(view({ notes: 'Pay by KNET' }), 'ar')).toContain('Pay by KNET')
  })
})
