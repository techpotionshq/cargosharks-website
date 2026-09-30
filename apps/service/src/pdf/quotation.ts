/**
 * The quotation — FR-EQ-08, and the second half of the pilot's Moment 2.
 *
 * The rating engine produces a price; this is the artefact the customer
 * actually receives, and the one the demo script says out loud. It is a
 * commercial offer rather than a record of work, which decides almost
 * everything about how it is built:
 *
 * ## Validity is not a footnote
 *
 * A quotation with no expiry is an open-ended commitment, and in a market
 * where ocean rates move fortnightly that is how a forwarder loses money
 * politely. `validUntil` prints in the header rather than the small print, and
 * an expired quotation says so across its face — the same treatment
 * `invoice.ts` gives a draft, for the same reason: the reader must not be able
 * to mistake it.
 *
 * ## What is *not* on it matters as much as what is
 *
 * Buy-side cost and margin never reach this template. They are not in the view
 * it takes, which is a stronger guarantee than remembering not to print them:
 * the type makes a quotation that leaks the margin fail to compile. The
 * internal comparison view (FR-EQ-07) is a screen, and it stays one.
 *
 * ## Exclusions are a list, not a disclaimer
 *
 * "Duties, taxes and customs examination charges are excluded" is the sentence
 * that decides who pays when the container is pulled for inspection. Printing
 * exclusions as their own block beside the charges — rather than folding them
 * into the trading conditions at the foot — is the difference between a term
 * the customer read and one they were deemed to have read.
 */

import {
  esc,
  escBlock,
  field,
  formatDate,
  formatMoney,
  letterhead,
  localised,
  ltr,
  page,
  type DocumentLocale,
  type IssuingEntity,
} from './document-kit'

interface QuotationLineView {
  readonly chargeNameEn: string
  readonly chargeNameAr: string | null
  /** What the operator typed over the charge type's own name, where they did. */
  readonly description: string | null
  readonly basis: string
  readonly quantity: string
  readonly rate: string
  readonly amount: string
}

/**
 * Both languages travel in the view and the template picks.
 *
 * The same shape `JobDocumentView` uses, and the reason is that one loader
 * serves both renderings: an English and an Arabic quotation of the same
 * offer must be the same offer, and localising in the loader would mean
 * running it twice and trusting the two results to agree.
 */
export interface QuotationView extends IssuingEntity {
  readonly reference: string
  readonly version: number
  readonly status: string
  readonly currency: string
  readonly total: string | null
  readonly validUntil: string | null
  readonly preparedBy: string | null
  readonly issuedAt: Date
  readonly customer: { readonly nameEn: string; readonly nameAr: string | null }
  readonly enquiryReference: string
  readonly mode: string | null
  readonly incoterm: string | null
  readonly originEn: string | null
  readonly originAr: string | null
  readonly destinationEn: string | null
  readonly destinationAr: string | null
  readonly transitDays: number | null
  /** The covering paragraph per language; render picks by locale, as elsewhere. */
  readonly coverNoteEn: string | null
  readonly coverNoteAr: string | null
  readonly notes: string | null
  readonly inclusions: readonly string[]
  readonly exclusions: readonly string[]
  /** Empty falls back to the English list rather than printing nothing. */
  readonly exclusionsAr: readonly string[]
  readonly tradingConditionsEn: string | null
  readonly tradingConditionsAr: string | null
  readonly lines: readonly QuotationLineView[]
}

const STRINGS = {
  en: {
    title: 'Quotation',
    quotationNo: 'Quotation no.',
    date: 'Date',
    validUntil: 'Valid until',
    preparedBy: 'Prepared by',
    quotedTo: 'Quoted to',
    shipment: 'Shipment',
    enquiry: 'Enquiry',
    mode: 'Mode',
    incoterm: 'Incoterm',
    route: 'Route',
    transit: 'Transit',
    days: 'days',
    charge: 'Charge',
    basis: 'Basis',
    qty: 'Qty',
    rate: 'Rate',
    amount: 'Amount',
    total: 'Total',
    inclusions: 'Included',
    exclusions: 'Not included',
    notes: 'Notes',
    conditions: 'Standard trading conditions',
    expired: 'EXPIRED',
    superseded: 'SUPERSEDED',
    draft: 'DRAFT — not a quotation until sent',
    noValidity: 'No expiry stated',
    revision: 'Revision',
  },
  ar: {
    title: 'عرض سعر',
    quotationNo: 'رقم العرض',
    date: 'التاريخ',
    validUntil: 'صالح حتى',
    preparedBy: 'أعدّه',
    quotedTo: 'إلى',
    shipment: 'الشحنة',
    enquiry: 'الطلب',
    mode: 'وسيلة النقل',
    incoterm: 'شرط التسليم',
    route: 'خط السير',
    transit: 'مدة النقل',
    days: 'يوماً',
    charge: 'البند',
    basis: 'الأساس',
    qty: 'الكمية',
    rate: 'السعر',
    amount: 'المبلغ',
    total: 'الإجمالي',
    inclusions: 'يشمل',
    exclusions: 'لا يشمل',
    notes: 'ملاحظات',
    conditions: 'الشروط العامة للتعامل',
    expired: 'منتهي الصلاحية',
    superseded: 'مُستبدل',
    draft: 'مسودة — ليست عرض سعر حتى يُرسل',
    noValidity: 'لم تُحدد مدة الصلاحية',
    revision: 'المراجعة',
  },
} as const

/**
 * Modes and bases print as words, not as their enum keys.
 *
 * `sea_fcl` on a customer-facing document is our schema leaking onto their
 * desk. The Arabic is written rather than transliterated for the same reason
 * the notification templates are: a Kuwaiti customer can tell.
 */
const MODES: Record<string, readonly [string, string]> = {
  sea_fcl: ['Sea — FCL', 'بحري — حاوية كاملة'],
  sea_lcl: ['Sea — LCL', 'بحري — بضاعة مجمعة'],
  air: ['Air', 'جوي'],
  land: ['Land', 'بري'],
  courier: ['Courier', 'شحن سريع'],
}

const BASES: Record<string, readonly [string, string]> = {
  flat: ['Flat', 'مقطوع'],
  per_unit: ['Per unit', 'للوحدة'],
  per_kg: ['Per kg', 'للكيلوغرام'],
  per_container: ['Per container', 'للحاوية'],
  per_day: ['Per day', 'لليوم'],
  percent: ['Percent', 'نسبة مئوية'],
}

const word = (
  table: Record<string, readonly [string, string]>,
  key: string | null,
  locale: DocumentLocale,
): string => {
  if (!key) return '—'
  const pair = table[key]
  return pair ? pair[locale === 'ar' ? 1 : 0] : key
}

/**
 * Whether the offer has lapsed, decided against the day it is printed.
 *
 * Date-only comparison in the branch's own zone: a quotation valid until the
 * 30th is valid all day on the 30th, and comparing a date column against an
 * instant makes it expire at midnight UTC — three hours early in Kuwait, which
 * is the sort of wrong that only shows up in the customer's complaint.
 */
export function hasExpired(validUntil: string | null, on: Date): boolean {
  if (!validUntil) return false
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(on)
  return validUntil < today
}

/**
 * A quantity as a person writes it: `numeric(19,6)` arrives as "2.000000", and
 * the quotation printed exactly that. Trailing zeros go; a real fraction stays.
 */
function quantity(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value
}

export function renderQuotationHtml(quote: QuotationView, locale: DocumentLocale): string {
  const t = STRINGS[locale]
  const money = (value: string): string => esc(formatMoney(value, quote.currency, locale))
  const name = (line: QuotationLineView): string =>
    line.description ?? localised(line.chargeNameEn, line.chargeNameAr, locale)

  const lane = [
    localised(quote.originEn, quote.originAr, locale),
    localised(quote.destinationEn, quote.destinationAr, locale),
  ].filter((part) => part !== '')

  const conditions = localised(quote.tradingConditionsEn, quote.tradingConditionsAr, locale)
  const coverNote = localised(quote.coverNoteEn, quote.coverNoteAr, locale)

  // Arabic where the entity supplied it, English where it did not. A blank
  // block would read as "nothing is excluded", which is the opposite.
  const exclusions =
    locale === 'ar' && quote.exclusionsAr.length > 0 ? quote.exclusionsAr : quote.exclusions

  /*
    The inclusions are the charged lines' names, frozen in English in the
    priced snapshot — so the Arabic quotation listed "Ocean Freight" and
    "Haulage" under يشمل. Each is shown by its Arabic name where one of the
    lines carries it; a name no line matches (typed by hand) stays as written.
  */
  const arabicNames = new Map(
    quote.lines.flatMap((line) =>
      line.chargeNameAr ? [[line.chargeNameEn, line.chargeNameAr] as const] : [],
    ),
  )
  const inclusions =
    locale === 'ar'
      ? quote.inclusions.map((item) => arabicNames.get(item) ?? item)
      : quote.inclusions

  /*
    One overlay, and the order is the order of consequence.

    A superseded quotation is the dangerous one — it was a real offer and there
    is now a different real offer at a different price — so it outranks a mere
    expiry. Expiry outranks draft, because an expired quotation has been in the
    customer's hands and a draft never left the building.

    Printed at all because these three states are invisible otherwise: a
    superseded quotation is a correct-looking document with the wrong number on
    it, and the copy in the customer's inbox does not update when the record
    does.
  */
  const overlay =
    quote.status === 'superseded'
      ? t.superseded
      : hasExpired(quote.validUntil, quote.issuedAt)
        ? t.expired
        : quote.status === 'draft'
          ? t.draft
          : null

  const lines = quote.lines
    .map(
      (line) => `<tr>
  <td>${esc(name(line))}</td>
  <td>${esc(word(BASES, line.basis, locale))}</td>
  <td class="n">${esc(quantity(line.quantity))}</td>
  <td class="n">${money(line.rate)}</td>
  <td class="n">${money(line.amount)}</td>
</tr>`,
    )
    .join('\n')

  const bullets = (items: readonly string[]): string =>
    items.map((item) => `<li>${esc(item)}</li>`).join('')

  const terms = [
    inclusions.length > 0
      ? `<div class="col"><h2>${esc(t.inclusions)}</h2><ul>${bullets(inclusions)}</ul></div>`
      : '',
    exclusions.length > 0
      ? `<div class="col"><h2>${esc(t.exclusions)}</h2><ul>${bullets(exclusions)}</ul></div>`
      : '',
  ]
    .filter(Boolean)
    .join('')

  return page(
    locale,
    `<body>
${overlay ? `<div class="draft">${esc(overlay)}</div>` : ''}
${letterhead(quote, t.title, `${t.quotationNo} ${quote.reference}`, locale)}

<div class="row">
  ${field(t.date, esc(formatDate(quote.issuedAt, locale)))}
  ${field(
    t.validUntil,
    quote.validUntil
      ? `<strong>${esc(formatDate(quote.validUntil, locale))}</strong>`
      : `<span class="muted">${esc(t.noValidity)}</span>`,
  )}
  ${quote.version > 1 ? field(t.revision, ltr(String(quote.version))) : ''}
  ${field(t.enquiry, ltr(esc(quote.enquiryReference)))}
  ${quote.preparedBy ? field(t.preparedBy, esc(quote.preparedBy)) : ''}
</div>

<div class="grid">
  <div class="cell">
    <h2>${esc(t.quotedTo)}</h2>
    <strong>${esc(locale === 'ar' ? (quote.customer.nameAr ?? quote.customer.nameEn) : quote.customer.nameEn)}</strong>
  </div>
  <div class="cell">
    <h2>${esc(t.shipment)}</h2>
    <div>${esc(word(MODES, quote.mode, locale))}</div>
    <div class="muted">${esc(lane.join(' → ') || '—')}</div>
    <div class="muted">${quote.incoterm ? ltr(esc(quote.incoterm)) : ''}${
      quote.transitDays === null ? '' : ` · ${esc(String(quote.transitDays))} ${esc(t.days)}`
    }</div>
  </div>
</div>

${coverNote ? `<div class="cover">${escBlock(coverNote)}</div>` : ''}

<table>
  <thead>
    <tr>
      <th>${esc(t.charge)}</th>
      <th>${esc(t.basis)}</th>
      <th class="n">${esc(t.qty)}</th>
      <th class="n">${esc(t.rate)}</th>
      <th class="n">${esc(t.amount)}</th>
    </tr>
  </thead>
  <tbody>
${lines}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="4">${esc(t.total)}</td>
      <td class="n">${quote.total === null ? '—' : money(quote.total)}</td>
    </tr>
  </tfoot>
</table>

${terms ? `<div class="cols">${terms}</div>` : ''}
${quote.notes ? `<div class="terms"><h2>${esc(t.notes)}</h2>${escBlock(quote.notes)}</div>` : ''}
${conditions ? `<div class="terms"><h2>${esc(t.conditions)}</h2>${escBlock(conditions)}</div>` : ''}
</body>`,
    QUOTATION_CSS,
  )
}

const QUOTATION_CSS = `
  .cover { margin: 4mm 0 1mm; font-size: 9pt; line-height: 1.5; }
  .cols { display: flex; gap: 8mm; margin-top: 5mm; }
  .cols .col { flex: 1; }
  .cols ul { margin: 0; padding-inline-start: 4mm; color: var(--muted); font-size: 8.5pt; }
  .cols li { margin-bottom: 0.8mm; }
`
