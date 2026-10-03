/**
 * The invoice document — FR-FN, §8, NFR-01.
 *
 * The one output a forwarder cannot operate without. Everything else in the
 * system arranges work; this is the artefact that gets money in.
 *
 * ## Bilingual, and not by translating at the end
 *
 * Every entity a document renders carries an Arabic name column, and the
 * layout is written in CSS logical properties (`margin-inline-start`, never
 * `margin-left`) so the same template mirrors under `dir="rtl"` without a
 * second stylesheet. That is the whole reason `apps/web` was written the same
 * way — one set of rules, two directions.
 *
 * ## Money is formatted from the currency's own scale
 *
 * `Intl.NumberFormat` with the currency code, never `toFixed(2)`. KWD carries
 * three decimals; a global two-decimal format corrupts every Kuwaiti amount on
 * the page and looks entirely reasonable while doing it. Digits are forced
 * Latin in Arabic (`-u-nu-latn`) for the same reason `lib/format.ts` does it:
 * Eastern Arabic numerals are unreadable to half the office and unparseable by
 * everything downstream.
 *
 * ## The colours come from the brand
 *
 * `:root` used to be five hex values ending in `--brand:#8c1d18`. See
 * `./brand.ts` for why that was a customer-visible bug rather than a tidiness
 * one; the short version is that the maroon belongs to one client and the
 * invoice is issued by whichever operator `BRAND` selects.
 */

import { dec, readInvoiceNote } from '@qabandi/core'
import { documentBrandCss, PRINT_THEME_ATTR } from './brand'

interface InvoiceLineView {
  readonly descriptionEn: string
  readonly descriptionAr: string | null
  readonly quantity: string
  readonly unitPrice: string
  readonly amount: string
  readonly taxAmount: string
}

export interface InvoiceView {
  readonly seriesNo: string | null
  readonly issuedAt: Date | null
  readonly dueOn: string | null
  readonly currency: string
  readonly subtotal: string
  readonly taxAmount: string
  readonly total: string
  readonly amountPaid: string
  /**
   * Partial credit notes against it (F9). Optional so a view built before
   * partial credit existed still renders; absent reads as nothing credited.
   */
  readonly amountCredited?: string
  readonly notes: string | null
  /**
   * The invoice's own language, which a download that asks for none renders
   * in. Optional so a view built without it renders in English, as before.
   */
  readonly language?: DocumentLocale
  /**
   * Set when this document is a credit note, with the invoice it credits.
   * Optional so a view built without it renders as an invoice, as before.
   */
  readonly creditNote?: {
    readonly creditsSeriesNo: string | null
    readonly creditsIssuedAt: Date | null
  } | null
  readonly customer: { readonly nameEn: string; readonly nameAr: string | null }
  readonly branch: {
    readonly legalNameEn: string
    readonly legalNameAr: string
    readonly taxRegistration: string | null
  }
  readonly lines: readonly InvoiceLineView[]
}

export type DocumentLocale = 'en' | 'ar'

/** `ar-KW-u-nu-latn` — Arabic conventions, Latin digits. See `lib/format.ts`. */
const intlLocale = (locale: DocumentLocale): string =>
  locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB'

/**
 * `Intl` decides the scale from the currency, which is the point.
 *
 * KWD is three decimals, USD and AED are two. Hard-coding either produces an
 * invoice that is wrong in one of the operator's five entities, and the error
 * is invisible because the number still looks like money.
 */
function formatMoney(value: string, currency: string, locale: DocumentLocale): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).format(
    Number(value),
  )
}

function formatDate(value: Date | string | null, locale: DocumentLocale): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kuwait',
  }).format(date)
}

/**
 * Escapes text before it reaches the document.
 *
 * Customer names, descriptions and notes are operator-entered and arrive here
 * as markup. Without this an ampersand in a legal name breaks the document,
 * and a `<script>` in a line description runs inside the renderer — which is a
 * browser process in our own container.
 */
function esc(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const STRINGS = {
  en: {
    title: 'Tax Invoice',
    issued: 'Issued',
    due: 'Due',
    billTo: 'Bill to',
    description: 'Description',
    qty: 'Qty',
    unit: 'Unit price',
    amount: 'Amount',
    subtotal: 'Subtotal',
    tax: 'Tax',
    total: 'Total',
    paid: 'Received',
    credited: 'Credited',
    balance: 'Balance due',
    trn: 'Tax registration',
    draft: 'DRAFT — not a valid tax invoice',
    billedFrom: 'Billed from',
    creditTitle: 'Credit Note',
    creditTo: 'Credit to',
    credits: 'Credits invoice',
    dated: 'dated',
    creditTotal: 'Total credit',
  },
  ar: {
    title: 'فاتورة ضريبية',
    issued: 'تاريخ الإصدار',
    due: 'تاريخ الاستحقاق',
    billTo: 'إلى',
    description: 'البيان',
    qty: 'الكمية',
    unit: 'سعر الوحدة',
    amount: 'المبلغ',
    subtotal: 'المجموع الفرعي',
    tax: 'الضريبة',
    total: 'الإجمالي',
    paid: 'المدفوع',
    credited: 'إشعارات دائنة',
    balance: 'الرصيد المستحق',
    trn: 'الرقم الضريبي',
    draft: 'مسودة — ليست فاتورة ضريبية صالحة',
    billedFrom: 'مفوترة من',
    creditTitle: 'إشعار دائن',
    creditTo: 'لصالح',
    credits: 'إشعار دائن للفاتورة',
    dated: 'بتاريخ',
    creditTotal: 'إجمالي الإشعار الدائن',
  },
} as const

export function renderInvoiceHtml(invoice: InvoiceView, locale: DocumentLocale): string {
  const t = STRINGS[locale]
  const dir = locale === 'ar' ? 'rtl' : 'ltr'
  /*
    A credit note is its own document, not an invoice with a second number
    (N2). It printed as "Tax Invoice" with positive amounts and no word of the
    invoice it reduces, and a customer reads that as a second bill. So it says
    what it is, names the invoice and its date, and every amount is a credit,
    shown negative. Its received and balance lines are left off: a note is
    "paid" by construction (it carries its own total as settled), and
    "Balance due 0.000" on a credit says nothing true.
  */
  const credit = invoice.creditNote ?? null
  // Zero stays zero: a "-KWD 0.000" tax line reads as a typo.
  const signed = (value: string): string =>
    credit && !dec(value).isZero() ? dec(value).negated().toFixed(6) : value
  const money = (value: string): string => esc(formatMoney(signed(value), invoice.currency, locale))
  /*
    A job-billed note in this document's language (NEW-6); the reference is
    isolated left-to-right so an Arabic line does not reverse its groups. A
    note a person typed prints as typed, in its own direction.
  */
  const note = readInvoiceNote(invoice.notes)
  const noteHtml = !note
    ? ''
    : note.kind === 'billedFrom'
      ? `<div class="notes">${t.billedFrom} <bdi dir="ltr">${esc(note.reference)}</bdi></div>`
      : `<div class="notes" dir="auto">${esc(note.text)}</div>`

  // In decimal, as every other balance: KWD's third place does not survive a float.
  const credited = invoice.amountCredited ?? '0'
  const balance = dec(invoice.total).minus(dec(invoice.amountPaid)).minus(dec(credited)).toFixed(6)
  const customerName =
    locale === 'ar' ? (invoice.customer.nameAr ?? invoice.customer.nameEn) : invoice.customer.nameEn
  const entityName = locale === 'ar' ? invoice.branch.legalNameAr : invoice.branch.legalNameEn

  const lines = invoice.lines
    .map((line) => {
      const description =
        locale === 'ar' ? (line.descriptionAr ?? line.descriptionEn) : line.descriptionEn
      return `<tr><td>${esc(description)}</td><td class="n">${esc(String(Number(line.quantity)))}</td><td class="n">${money(line.unitPrice)}</td><td class="n">${money(line.amount)}</td></tr>`
    })
    .join('')

  /*
    An unissued invoice is watermarked rather than refused.

    A draft is a legitimate thing to hand a colleague to check, and refusing to
    render one pushes people to screenshots. But it must never be mistaken for
    a document a customer can pay against: `series_no` stays null until the
    branch's statutory sequence assigns one.
  */
  const draft = invoice.seriesNo ? '' : `<div class="draft">${t.draft}</div>`

  /*
    Received and credited on lines of their own: a customer reconciling the
    balance against their remittances must be able to see which part of the
    reduction was a credit note rather than money they sent (F9).
  */
  const paidRow = dec(invoice.amountPaid).greaterThan(0)
    ? `<tr><td colspan="3" class="label">${t.paid}</td><td class="n">${money(invoice.amountPaid)}</td></tr>`
    : ''
  const creditedRow = dec(credited).greaterThan(0)
    ? `<tr><td colspan="3" class="label">${t.credited}</td><td class="n">${money(credited)}</td></tr>`
    : ''
  const settled =
    !credit && (paidRow || creditedRow)
      ? `${paidRow}${creditedRow}
         <tr class="grand"><td colspan="3" class="label">${t.balance}</td><td class="n">${money(balance)}</td></tr>`
      : ''

  // The series number isolated left-to-right, as the billed-from note's is.
  const creditsRow = credit
    ? `<div class="credits"><span class="muted">${t.credits}</span> <bdi dir="ltr">${esc(
        credit.creditsSeriesNo ?? '—',
      )}</bdi> <span class="muted">${t.dated}</span> ${esc(
        formatDate(credit.creditsIssuedAt, locale),
      )}</div>`
    : ''

  return `<!doctype html>
<html lang="${locale}" dir="${dir}" ${PRINT_THEME_ATTR}>
<meta charset="utf-8">
<style>
${documentBrandCss()}
  * { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans', 'Noto Sans Arabic', 'KacstOne', 'Liberation Sans', sans-serif;
    color: var(--ink); font-size: 10pt; margin: 0; line-height: 1.5;
  }
  /* Logical properties throughout, so one set of rules mirrors under dir=rtl. */
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  .muted { color: var(--muted); }
  .head { display: flex; justify-content: space-between; gap: 10mm; margin-bottom: 8mm; }
  .entity { text-align: end; }
  .meta { margin-bottom: 6mm; }
  .meta div { margin-bottom: 1mm; }
  table { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  th, td { padding: 2.5mm 2mm; border-bottom: 1px solid var(--line); text-align: start; vertical-align: top; }
  th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
       border-bottom: 1.5px solid var(--ink); }
  .n { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { border-bottom: none; padding-block: 1.2mm; }
  tfoot .label { text-align: end; color: var(--muted); }
  tfoot .grand td { border-top: 1.5px solid var(--ink); font-weight: 600; font-size: 11pt; }
  .draft { position: fixed; inset-block-start: 40%; inset-inline: 0; text-align: center;
           font-size: 34pt; color: var(--brand-wash); font-weight: 700; transform: rotate(-18deg); }
  .notes { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid var(--line);
           color: var(--muted); font-size: 9pt; }
</style>

${draft}

<div class="head">
  <div>
    <h1>${credit ? t.creditTitle : t.title}</h1>
    <div class="muted">${esc(invoice.seriesNo ?? '—')}</div>
  </div>
  <div class="entity">
    <strong>${esc(entityName)}</strong>
    ${invoice.branch.taxRegistration ? `<div class="muted">${t.trn}: ${esc(invoice.branch.taxRegistration)}</div>` : ''}
  </div>
</div>

<div class="meta">
  <div><span class="muted">${credit ? t.creditTo : t.billTo}:</span> <strong>${esc(customerName)}</strong></div>
  ${creditsRow}
  <div><span class="muted">${t.issued}:</span> ${esc(formatDate(invoice.issuedAt, locale))}${
    credit
      ? ''
      : `
       &nbsp;·&nbsp; <span class="muted">${t.due}:</span> ${esc(formatDate(invoice.dueOn, locale))}`
  }</div>
</div>

<table>
  <thead><tr>
    <th>${t.description}</th><th class="n">${t.qty}</th>
    <th class="n">${t.unit}</th><th class="n">${t.amount}</th>
  </tr></thead>
  <tbody>${lines}</tbody>
  <tfoot>
    <tr><td colspan="3" class="label">${t.subtotal}</td><td class="n">${money(invoice.subtotal)}</td></tr>
    <tr><td colspan="3" class="label">${t.tax}</td><td class="n">${money(invoice.taxAmount)}</td></tr>
    <tr class="grand"><td colspan="3" class="label">${credit ? t.creditTotal : t.total}</td><td class="n">${money(invoice.total)}</td></tr>
    ${settled}
  </tfoot>
</table>

${noteHtml}
</html>`
}
