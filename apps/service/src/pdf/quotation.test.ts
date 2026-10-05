/**
 * The quotation template — FR-EQ-08.
 *
 * A pure function of its view, tested here rather than through a rendered PDF
 * for the same reason the bill of lading is: what goes wrong on a quotation is
 * escaping, a total that disagrees with its lines, and a term silently going
 * missing. None of those need a browser.
 *
 * Two things get disproportionate attention below, because both are the kind
 * of defect that produces a document which looks entirely correct:
 *
 * **The margin must not be on it.** Cost and margin are not in `QuotationView`
 * at all, so the compiler already refuses. What the tests add is the check
 * that nothing reconstructs them — a `total` that is quietly the buy figure
 * would render perfectly and lose the account.
 *
 * **A lapsed offer must say so.** An expired quotation is a valid-looking
 * price list. The overlay is the only thing between that and a customer
 * holding us to a rate from two monsoons ago.
 */

import { describe, expect, it } from 'vitest'
import { hasExpired, renderQuotationHtml, type QuotationView } from './quotation'

/** The day the fixture was sent — inside its validity, for the overlay tests. */
const ISSUED = new Date('2026-06-15T09:00:00Z')

const base: QuotationView = {
  reference: 'QT-KWI-2026-00184',
  version: 1,
  status: 'sent',
  currency: 'KWD',
  total: '1284.500',
  validUntil: '2026-07-15',
  preparedBy: 'Noura Al-Sabah',
  issuedAt: new Date('2026-06-15T09:00:00Z'),
  customer: { nameEn: 'Gulf Trading Co.', nameAr: 'شركة الخليج للتجارة' },
  enquiryReference: 'ENQ-KWI-2026-00311',
  mode: 'sea_fcl',
  incoterm: 'CIF',
  originEn: 'Jebel Ali',
  originAr: 'جبل علي',
  destinationEn: 'Shuwaikh',
  destinationAr: 'الشويخ',
  transitDays: 4,
  coverNoteEn: null,
  coverNoteAr: null,
  notes: null,
  inclusions: ['Ocean freight', 'Terminal handling at destination'],
  exclusions: ['Duties and taxes', 'Customs examination charges'],
  exclusionsAr: ['الرسوم والضرائب', 'مصاريف الفحص الجمركي'],
  branch: {
    legalNameEn: 'Al-Qabandi & Partners Co.',
    legalNameAr: 'شركة القبندي وشركاه',
    taxRegistration: 'KW-TRN-4471',
  },
  tradingConditionsEn: 'All business undertaken subject to our standard trading conditions.',
  tradingConditionsAr: 'تخضع جميع الأعمال لشروط التعامل العامة لدينا.',
  lines: [
    {
      chargeNameEn: 'Ocean freight',
      chargeNameAr: 'أجرة الشحن البحري',
      description: null,
      basis: 'per_container',
      quantity: '2',
      rate: '540.000',
      amount: '1080.000',
    },
    {
      chargeNameEn: 'Documentation',
      chargeNameAr: 'رسوم المستندات',
      description: null,
      basis: 'flat',
      quantity: '1',
      rate: '204.500',
      amount: '204.500',
    },
  ],
}

const quote = (over: Partial<QuotationView> = {}): QuotationView => ({ ...base, ...over })

/**
 * The document without its stylesheet.
 *
 * `DOCUMENT_CSS` is full of `margin:` declarations, so a page that leaks the
 * *commercial* margin and a page that merely has spacing look identical to a
 * naive search. Everything the reader can actually see is after `</style>`.
 */
const visible = (html: string): string => html.slice(html.indexOf('</style>'))

describe('the quotation', () => {
  it('names the issuing entity and the quotation', () => {
    const html = renderQuotationHtml(quote(), 'en')

    expect(html).toContain('Quotation')
    expect(html).toContain('QT-KWI-2026-00184')
    expect(html).toContain('Al-Qabandi &amp; Partners Co.')
    expect(html).toContain('KW-TRN-4471')
  })

  it('prints the charge breakdown and its total', () => {
    const html = renderQuotationHtml(quote(), 'en')

    expect(html).toContain('Ocean freight')
    expect(html).toContain('Documentation')
    // KWD is three decimals. A global two-decimal format would read 1,284.50.
    expect(html).toContain('1,284.500')
  })

  /**
   * The whole reason `QuotationView` is a narrower type than the quote row.
   *
   * `total_cost` sits beside `total_sell` in the table and this document must
   * never carry it. The type stops it being passed; this stops it being
   * reconstructed from something else that happens to be on the page.
   */
  it('carries nothing the customer must not see', () => {
    const body = visible(renderQuotationHtml(quote(), 'en'))

    expect(body).not.toMatch(/margin/i)
    expect(body).not.toMatch(/\bcost\b/i)
    expect(body).not.toMatch(/\bbuy\b/i)
    // The one total on the page is the sell total it was given.
    expect(body.match(/1,284\.500/g)).toHaveLength(1)
  })

  describe('validity', () => {
    it('states the expiry where there is one', () => {
      expect(renderQuotationHtml(quote(), 'en')).toContain('Valid until')
    })

    /** Silence would read as "no expiry", which is an open-ended offer. */
    it('says so plainly where there is none', () => {
      const html = renderQuotationHtml(quote({ validUntil: null }), 'en')

      expect(html).toContain('No expiry stated')
    })

    it('marks a lapsed offer across its face', () => {
      const html = renderQuotationHtml(
        quote({ validUntil: '2026-06-01', issuedAt: new Date('2026-06-15T09:00:00Z') }),
        'en',
      )

      expect(html).toContain('EXPIRED')
    })

    /**
     * Sent while valid, printed after it lapsed — the copy the overlay is for.
     * It compared against the send date, on which every quote is still valid.
     */
    it('marks a quotation sent before it lapsed when it is printed after', () => {
      const sentWhileValid = quote({
        validUntil: '2026-06-20',
        issuedAt: new Date('2026-06-15T09:00:00Z'),
      })

      expect(renderQuotationHtml(sentWhileValid, 'en', new Date('2026-06-25T09:00:00Z'))).toContain(
        'EXPIRED',
      )
      expect(
        renderQuotationHtml(sentWhileValid, 'en', new Date('2026-06-18T09:00:00Z')),
      ).not.toContain('EXPIRED')
    })

    /**
     * A quotation valid until the 30th is valid all day on the 30th.
     *
     * Comparing a date column against an instant expires it at midnight UTC,
     * which is three hours early in Kuwait — a customer who accepts at 09:00
     * on the last day is told they are too late.
     */
    it('is still live on its final day, in Kuwait', () => {
      // 21:00 UTC on the 15th is midnight on the 16th in Kuwait... but the
      // quotation is valid until the 16th, so it has not lapsed.
      expect(hasExpired('2026-07-16', new Date('2026-07-15T21:00:00Z'))).toBe(false)
      // The same instant against a validity of the 15th has lapsed, because
      // in Kuwait it is already the 16th.
      expect(hasExpired('2026-07-15', new Date('2026-07-15T21:00:00Z'))).toBe(true)
    })

    it('never expires without a date', () => {
      expect(hasExpired(null, new Date('2030-01-01T00:00:00Z'))).toBe(false)
    })
  })

  describe('the overlay', () => {
    /** Superseded outranks expired: there is a different live price. */
    it('prefers superseded over expired', () => {
      const html = renderQuotationHtml(
        quote({ status: 'superseded', validUntil: '2020-01-01' }),
        'en',
      )

      expect(html).toContain('SUPERSEDED')
      expect(html).not.toContain('EXPIRED')
    })

    it('marks a draft that has not been sent', () => {
      // Printed the day it was drafted, inside its validity.
      expect(renderQuotationHtml(quote({ status: 'draft' }), 'en', ISSUED)).toContain('DRAFT')
    })

    it('leaves a live quotation unmarked', () => {
      // Printed within its validity — the overlay is decided by the print date.
      const html = renderQuotationHtml(quote(), 'en', ISSUED)

      expect(html).not.toContain('EXPIRED')
      expect(html).not.toContain('SUPERSEDED')
      expect(html).not.toContain('DRAFT')
    })
  })

  describe('inclusions and exclusions', () => {
    it('prints both lists', () => {
      const html = renderQuotationHtml(quote(), 'en')

      expect(html).toContain('Included')
      expect(html).toContain('Ocean freight')
      expect(html).toContain('Not included')
      expect(html).toContain('Customs examination charges')
    })

    /** An empty heading over nothing reads as an omission. */
    it('omits a heading it has nothing to put under', () => {
      const html = renderQuotationHtml(quote({ exclusions: [] }), 'en')

      expect(html).toContain('Included')
      expect(html).not.toContain('Not included')
    })
  })

  /** `numeric(19,6)` arrives as "2.000000"; nobody writes a container count so. */
  it('prints a quantity without trailing zeros, and keeps a real fraction', () => {
    const body = visible(
      renderQuotationHtml(
        quote({
          lines: [
            { ...base.lines[0]!, quantity: '2.000000' },
            { ...base.lines[1]!, quantity: '12.500000' },
          ],
        }),
        'en',
      ),
    )

    expect(body).not.toContain('2.000000')
    expect(body).toContain('>2<')
    expect(body).toContain('>12.5<')
  })

  describe('in Arabic', () => {
    /*
      The inclusions are the lines' English names, frozen in the snapshot. The
      Arabic quotation listed them in English under يشمل.
    */
    it('names the inclusions in Arabic where a line carries the name', () => {
      const body = visible(renderQuotationHtml(quote(), 'ar'))

      expect(body).toContain('أجرة الشحن البحري')
      // No line carries this one, so it stays as written rather than vanishing.
      expect(body).toContain('Terminal handling at destination')
    })

    it('runs right to left and uses the Arabic entity name', () => {
      const html = renderQuotationHtml(quote(), 'ar')

      expect(html).toContain('dir="rtl"')
      expect(html).toContain('شركة القبندي وشركاه')
      expect(html).toContain('عرض سعر')
    })

    it('takes the Arabic charge names and the Arabic conditions', () => {
      const html = renderQuotationHtml(quote(), 'ar')

      expect(html).toContain('أجرة الشحن البحري')
      expect(html).toContain('تخضع جميع الأعمال')
    })

    /**
     * Latin digits in Arabic, as everywhere else.
     *
     * Eastern Arabic numerals are unreadable to half the office and
     * unparseable by everything downstream — `lib/format.ts` makes the same
     * call for the same reason.
     */
    it('keeps the figures in Latin digits', () => {
      const html = renderQuotationHtml(quote(), 'ar')

      expect(html).toContain('1,284.500')
      expect(html).not.toMatch(/[٠-٩]/)
    })

    it('prints the Arabic exclusions, not the English ones', () => {
      const html = renderQuotationHtml(quote(), 'ar')

      expect(html).toContain('الرسوم والضرائب')
      expect(html).not.toContain('Duties and taxes')
    })

    /**
     * A blank block would read as "nothing is excluded", which is the
     * opposite of what it means.
     */
    it('falls back to the English exclusions where there is no Arabic', () => {
      const html = renderQuotationHtml(quote({ exclusionsAr: [] }), 'ar')

      expect(html).toContain('Duties and taxes')
    })

    /** Falls back rather than printing an empty footer. */
    it('falls back to the English conditions where there is no Arabic', () => {
      const html = renderQuotationHtml(quote({ tradingConditionsAr: null }), 'ar')

      expect(html).toContain('All business undertaken subject to')
    })
  })

  describe('what the operator typed', () => {
    it('prefers a line description over the charge type’s name', () => {
      const html = renderQuotationHtml(
        quote({
          lines: [{ ...base.lines[0]!, description: 'Ocean freight — Jebel Ali to Shuwaikh' }],
        }),
        'en',
      )

      expect(html).toContain('Ocean freight — Jebel Ali to Shuwaikh')
    })

    /**
     * Everything on this page is operator-entered and arrives as markup.
     *
     * Without escaping, an ampersand in a customer's legal name breaks the
     * document and a `<script>` in a line description runs inside the
     * renderer — which is a browser process in our own container.
     */
    it('escapes markup in anything it was given', () => {
      const html = renderQuotationHtml(
        quote({
          customer: { nameEn: '<script>alert(1)</script> & Co.', nameAr: null },
          notes: 'Rates subject to <b>space</b> & equipment',
        }),
        'en',
      )

      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
      expect(html).toContain('&amp; Co.')
      expect(html).toContain('&lt;b&gt;space&lt;/b&gt;')
    })

    /** Line breaks in a typed block carry meaning — see `escBlock`. */
    it('keeps the layout of a note that was typed as a block', () => {
      const html = renderQuotationHtml(quote({ notes: 'Line one\nLine two' }), 'en')

      expect(html).toContain('Line one<br>Line two')
    })
  })

  describe('the covering note', () => {
    it('prints the note where there is one, and nothing where there is not', () => {
      const withNote = renderQuotationHtml(
        quote({ coverNoteEn: 'Thank you for your enquiry on this lane.' }),
        'en',
      )
      expect(withNote).toContain('Thank you for your enquiry on this lane.')
      expect(withNote).toContain('class="cover"')

      // No note, no empty block.
      expect(renderQuotationHtml(quote(), 'en')).not.toContain('class="cover"')
    })

    it('takes the note in the reader’s language', () => {
      const both = quote({
        coverNoteEn: 'English cover note.',
        coverNoteAr: 'ملاحظة عربية مرافقة.',
      })
      expect(renderQuotationHtml(both, 'ar')).toContain('ملاحظة عربية مرافقة.')
      expect(renderQuotationHtml(both, 'ar')).not.toContain('English cover note.')
    })

    it('escapes and keeps the layout of the drafted prose', () => {
      const html = renderQuotationHtml(
        quote({ coverNoteEn: 'Line one\nLine two & <b>more</b>' }),
        'en',
      )
      expect(html).toContain('Line one<br>Line two &amp; &lt;b&gt;more&lt;/b&gt;')
    })
  })

  describe('the shipment it is quoting', () => {
    it('prints the mode as a word, not as an enum key', () => {
      expect(renderQuotationHtml(quote(), 'en')).toContain('Sea — FCL')
      expect(renderQuotationHtml(quote(), 'en')).not.toContain('sea_fcl')
    })

    it('prints the basis as a word too', () => {
      expect(renderQuotationHtml(quote(), 'en')).toContain('Per container')
      expect(renderQuotationHtml(quote(), 'en')).not.toContain('per_container')
    })

    /** An unrecognised key prints itself rather than vanishing. */
    it('falls back to the key it does not know', () => {
      expect(renderQuotationHtml(quote({ mode: 'hyperloop' }), 'en')).toContain('hyperloop')
    })

    it('shows the lane and the transit time', () => {
      const html = renderQuotationHtml(quote(), 'en')

      expect(html).toContain('Jebel Ali → Shuwaikh')
      expect(html).toContain('4')
    })

    it('shows the revision number only on a revision', () => {
      expect(renderQuotationHtml(quote(), 'en')).not.toContain('Revision')
      expect(renderQuotationHtml(quote({ version: 2 }), 'en')).toContain('Revision')
    })
  })
})

/* See the same block in `invoice.test.ts`: no placeholder registration line. */
describe('the quotation registration line', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`prints no placeholder registration in ${locale}`, () => {
      const html = renderQuotationHtml(quote(), locale)
      expect(html).not.toContain('Commercial Registration')
      expect(html).not.toContain('Customs Licence')
      expect(html).not.toContain('السجل التجاري')
      expect(html).not.toContain('رخصة جمركية')
    })
  }
})
