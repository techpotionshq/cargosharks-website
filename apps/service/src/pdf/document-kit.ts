/**
 * What every job document shares — the view, the formatters, the stylesheet.
 *
 * `invoice.ts` was the first document and carried its own copies of all three,
 * which was right when there was one. There are now six, and six copies of a
 * currency formatter is six places for KWD's third decimal to go missing.
 *
 * The view below is deliberately *one* shape for all of them. A bill of
 * lading, a delivery order, a manifest and a packing list are four
 * arrangements of the same shipment — the same parties, the same cargo, the
 * same containers — and giving each its own loader would mean four queries
 * that can disagree about what is on the shipment. They differ in what they
 * show and what they mean, not in what they read.
 */

import { documentBrandCss, PRINT_THEME_ATTR } from './brand'

export type DocumentLocale = 'en' | 'ar'

/** `ar-KW-u-nu-latn` — Arabic conventions, Latin digits. See `lib/format.ts`. */
export const intlLocale = (locale: DocumentLocale): string =>
  locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB'

/**
 * Escapes text before it reaches the document.
 *
 * Everything on these pages is operator-entered or shipper-supplied and
 * arrives as markup. Without this an ampersand in a legal name breaks the
 * document and a `<script>` in a goods description runs inside the renderer,
 * which is a browser process in our own container.
 */
export function esc(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Preserves the layout of a block that was typed as a block.
 *
 * Marks and numbers and addresses are *laid out* by whoever entered them —
 * line breaks carry meaning on a bill of lading, where the marks have to match
 * what is stencilled on the carton. Collapsing them into a paragraph is a
 * discrepancy at the port.
 */
export function escBlock(value: string | null | undefined): string {
  return esc(value).replace(/\r?\n/g, '<br>')
}

/**
 * Isolates a run that is left-to-right no matter which way the page runs.
 *
 * Found by looking at an Arabic waybill: `+965 2222 0000` printed as
 * `0000 2222 965+`. It is not a font problem and not our markup — it is the
 * Unicode bidirectional algorithm doing exactly what it is specified to do.
 * A telephone number is neutral characters and European digits, and inside an
 * RTL paragraph the neutrals between them resolve to the paragraph's direction,
 * so the groups get laid out right to left. The digits within each group keep
 * their order, which is what makes it so easy to miss: every character is
 * present and the number is still wrong.
 *
 * Anything the reader must be able to dial, quote or type back needs this —
 * phone numbers, a master air waybill number, a unit that trails a figure.
 * Money and quantities do not: `Intl.NumberFormat` emits them as a single
 * run with no neutrals to resolve.
 */
export function ltr(value: string): string {
  return value === '' ? '' : `<span dir="ltr">${value}</span>`
}

/**
 * Isolates a run whose direction is whatever its first letter says it is.
 *
 * The second bidi fault, found after the first one was fixed: on the Arabic
 * face of a bill, `Shanghai Hongqiao Ltd.` printed as `.Shanghai Hongqiao
 * Ltd` — the full stop is neutral, it sits at the edge of the run, and at the
 * edge it resolves to the paragraph's direction, which is right-to-left. `ltr`
 * is the wrong tool here because the same box on the next bill holds an
 * Arabic name that must run the other way. `<bdi>` decides per run from its
 * own first strong character and keeps the trailing punctuation with the run.
 *
 * Every name, address line and description that may be in either language
 * gets this. Codes and numbers still get `ltr`: a container number has no
 * letters to decide by.
 */
export function bdi(value: string): string {
  return value === '' ? '' : `<bdi>${value}</bdi>`
}

/** `escBlock`, with every line isolated on its own — an address, marks. */
export function bdiBlock(value: string | null | undefined): string {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => bdi(esc(line)))
    .join('<br>')
}

/**
 * Prose typed as paragraphs, printed as paragraphs.
 *
 * The reverse-side terms of a bill are clauses separated by blank lines, and
 * a `<br>` chain renders them as one wall of text that a court has to find a
 * clause in. A blank line is a paragraph; a single newline stays a line break
 * within one.
 */
export function paragraphs(value: string | null | undefined): string {
  return String(value ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => `<p>${escBlock(p)}</p>`)
    .join('')
}

export function formatMoney(value: string, currency: string, locale: DocumentLocale): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).format(
    Number(value),
  )
}

/** Weights and volumes. Not money — no currency, and a fixed scale per unit. */
export function formatQuantity(
  value: string | number | null | undefined,
  locale: DocumentLocale,
  fractionDigits = 3,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(n)
}

export function formatDate(
  value: Date | string | null | undefined,
  locale: DocumentLocale,
): string {
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

/** Picks the Arabic column where there is one and we are rendering Arabic. */
export function localised(
  en: string | null | undefined,
  ar: string | null | undefined,
  locale: DocumentLocale,
): string {
  return locale === 'ar' ? (ar ?? en ?? '') : (en ?? '')
}

export interface PartyView {
  readonly role:
    'shipper' | 'consignee' | 'notify' | 'second_notify' | 'delivery_agent' | 'forwarding_agent'
  readonly nameEn: string
  readonly nameAr: string | null
  readonly address: string | null
  readonly city: string | null
  readonly country: string | null
  readonly contactName: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly taxId: string | null
}

export interface CargoView {
  readonly lineNo: number
  readonly marksAndNumbers: string | null
  readonly packageCount: number | null
  readonly packageType: string | null
  readonly descriptionEn: string
  readonly descriptionAr: string | null
  readonly hsCode: string | null
  readonly grossWeightKg: string | null
  readonly netWeightKg: string | null
  readonly volumeCbm: string | null
  readonly containerNo: string | null
}

export interface EquipmentView {
  readonly containerNo: string | null
  readonly containerType: string | null
  readonly sealNo: string | null
  readonly grossWeightKg: string | null
}

export interface PlaceView {
  readonly nameEn: string
  readonly nameAr: string | null
  readonly unlocode: string | null
}

/**
 * One shipment, as every document on it needs to see it.
 *
 * `houseBillNumber` may be null: a document can be produced before the number
 * is allocated, and each template decides for itself whether that is a draft
 * watermark or simply a blank field. A delivery order does not need one; a
 * bill of lading is not a bill of lading without it.
 */
export interface JobDocumentView {
  readonly reference: string
  readonly houseBillNumber: string | null
  readonly masterBillNumber: string | null
  readonly bookingNumber: string | null
  readonly customerReference: string | null
  readonly mode: string
  readonly tradeDirection: string
  readonly incoterm: string | null
  readonly vesselName: string | null
  readonly voyageNumber: string | null
  readonly flightNumber: string | null
  /**
   * What the consignment was rated on — the air waybill prints it in its own
   * box, and it has to be the number that was billed rather than one this
   * layer recomputed. The loader takes the job's stored figure where there is
   * one and derives it from the cargo where there is not; either way the
   * templates print what they are given.
   */
  readonly chargeableWeightKg: string | null
  /** Which side of that calculation won. Decides the waybill's rate class. */
  readonly chargeableBasis: 'gross' | 'volumetric' | 'minimum' | null
  /** The currency the charges are in, from the job's own revenue lines. */
  readonly currency: string | null
  readonly etd: Date | null
  readonly eta: Date | null
  readonly origin: PlaceView | null
  readonly destination: PlaceView | null
  readonly branch: {
    readonly legalNameEn: string
    readonly legalNameAr: string
    readonly taxRegistration: string | null
    readonly country: string
    /** The reverse side of the bill of lading, or null for no back page. */
    readonly billOfLadingTermsEn: string | null
    readonly billOfLadingTermsAr: string | null
  }
  readonly customer: { readonly nameEn: string; readonly nameAr: string | null }
  /**
   * The combined-transport boxes — where the goods were taken over and where
   * they are to be delivered, as against the ports the carrier runs between.
   * Free text, printed as given; null leaves the box empty, which is correct
   * for a port-to-port movement.
   */
  readonly placeOfReceipt: string | null
  readonly placeOfDelivery: string | null
  /**
   * When the goods went on board the vessel — the on-board notation.
   *
   * UCP 600 article 20 is why this is a separate date from `issuedAt`: a bank
   * examining a bill under a letter of credit takes the date of issue as the
   * date of shipment *unless* the bill carries an on-board notation with its
   * own date, and a bill without one is refused against a credit that calls
   * for a shipped bill — which is nearly all of them. Null prints a received-
   * for-shipment bill rather than inventing a date; the loader says where the
   * date comes from.
   */
  readonly shippedOnBoardAt: Date | null
  /** Telex release — the originals were surrendered on this date. */
  readonly houseBillSurrenderedAt: Date | null
  readonly parties: readonly PartyView[]
  readonly cargo: readonly CargoView[]
  readonly equipment: readonly EquipmentView[]
  readonly issuedAt: Date
  readonly placeOfIssue: string
  /** Whose account the freight is on. Printed on the bill; it is the contract. */
  readonly freightTerm: 'prepaid' | 'collect'
}

export function partyOf(view: JobDocumentView, role: PartyView['role']): PartyView | undefined {
  return view.parties.find((p) => p.role === role)
}

/**
 * Which side of the movement our customer is on, for a party box with no
 * party record (NEW-8): the consignee on an import, the shipper on an export,
 * and unknown on a cross-trade, where it may be either and is not guessed.
 * The templates fell back to the customer as shipper on every job, which
 * named a Kuwaiti importer as its own overseas supplier.
 */
export function customerSide(view: JobDocumentView): 'shipper' | 'consignee' | null {
  if (view.tradeDirection === 'import') return 'consignee'
  if (view.tradeDirection === 'export') return 'shipper'
  return null
}

export function partiesOf(view: JobDocumentView, role: PartyView['role']): PartyView[] {
  return view.parties.filter((p) => p.role === role)
}

/** Totals, computed here so four templates cannot disagree about them. */
export function cargoTotals(cargo: readonly CargoView[]): {
  packages: number
  grossWeightKg: string
  netWeightKg: string
  volumeCbm: string
} {
  const sum = (pick: (c: CargoView) => string | null): string =>
    cargo
      .reduce((acc, c) => acc + Number(pick(c) ?? 0), 0)
      .toFixed(3)
      .replace(/\.?0+$/, '')

  return {
    packages: cargo.reduce((acc, c) => acc + (c.packageCount ?? 0), 0),
    grossWeightKg: sum((c) => c.grossWeightKg) || '0',
    netWeightKg: sum((c) => c.netWeightKg) || '0',
    volumeCbm: sum((c) => c.volumeCbm) || '0',
  }
}

/**
 * The shared stylesheet.
 *
 * Logical properties throughout (`margin-inline-start`, never `margin-left`)
 * so one set of rules mirrors under `dir="rtl"` — the same reason `apps/web`
 * is written that way. Millimetres rather than pixels because these are
 * printed and then filed in a folder somebody has to close.
 *
 * It declares no colours of its own. Every `var()` below is bound in
 * `./brand.ts` and prepended by `page()` — the rules here say *which* token a
 * stamp or a rule line takes, never what colour that is.
 */
export const DOCUMENT_CSS = `
  * { box-sizing: border-box; }
  body {
    font-family: 'Noto Sans', 'Noto Sans Arabic', 'KacstOne', 'Liberation Sans', sans-serif;
    color: var(--ink); font-size: 9.5pt; margin: 0; line-height: 1.45;
  }
  h1 { font-size: 16pt; margin: 0 0 1mm; letter-spacing: .01em; }
  h2 { font-size: 10pt; margin: 0 0 1.5mm; text-transform: uppercase; letter-spacing: .05em;
       color: var(--muted); font-weight: 600; }
  .muted { color: var(--muted); }
  .head { display: flex; justify-content: space-between; gap: 8mm; margin-bottom: 5mm;
          padding-bottom: 3mm; border-bottom: 1.5px solid var(--ink); }
  .entity { text-align: end; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid var(--line); }
  .grid > .cell { padding: 2.5mm 3mm; border-inline-end: 1px solid var(--line);
                  border-block-end: 1px solid var(--line); }
  .grid > .cell:nth-child(2n) { border-inline-end: none; }
  .cell strong { display: block; font-size: 10pt; }
  .cell .addr { white-space: normal; }
  table { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  th, td { padding: 2mm; border-bottom: 1px solid var(--line); text-align: start;
           vertical-align: top; }
  th { font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
       border-bottom: 1.5px solid var(--ink); }
  .n { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 600; border-top: 1.5px solid var(--ink); border-bottom: none; }
  .row { display: flex; gap: 6mm; flex-wrap: wrap; margin-bottom: 3mm; }
  .field { min-width: 32mm; }
  .row.even { flex-wrap: nowrap; }
  .row.even .field { flex: 1 1 0; min-width: 0; }
  .field .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em;
                  color: var(--muted); display: block; }
  .draft { position: fixed; inset-block-start: 40%; inset-inline: 0; text-align: center;
           font-size: 34pt; color: var(--brand-wash); font-weight: 700;
           transform: rotate(-18deg); }
  .terms { margin-top: 4mm; padding-top: 3mm; border-top: 1px solid var(--line);
           color: var(--muted); font-size: 7.5pt; line-height: 1.4; }
  .sign { margin-top: 6mm; display: flex; gap: 12mm; }
  .sign div { flex: 1; border-top: 1px solid var(--ink); padding-top: 1.5mm; font-size: 8pt;
              color: var(--muted); }
  .stamp { display: inline-block; padding: 1mm 2.5mm; border: 1px solid var(--brand);
           color: var(--brand); font-size: 8pt; text-transform: uppercase;
           letter-spacing: .06em; border-radius: 1mm; }
  .sheet { position: relative; break-after: page; }
  .sheet:last-child { break-after: auto; }
  .sheet.face .head .entity { padding-block-start: 7mm; }
  .counterpart { position: absolute; inset-block-start: 0; inset-inline-end: 0;
                 font-size: 8pt; font-weight: 700; letter-spacing: .1em;
                 text-transform: uppercase; padding: 1mm 3mm; border: 1.5px solid var(--ink); }
  .counterpart.copy { color: var(--muted); border-color: var(--muted); font-weight: 600; }
  .surrendered { position: absolute; inset-block-start: 36%; inset-inline: 0; text-align: center;
                 transform: rotate(-14deg); pointer-events: none; }
  .surrendered span { display: inline-block; padding: 3mm 8mm; border: 2.5px solid var(--brand);
                      color: var(--brand); font-size: 22pt; font-weight: 700;
                      letter-spacing: .12em; text-transform: uppercase; opacity: .55;
                      background: var(--paper-veil); }
  .surrendered small { display: block; font-size: 10pt; letter-spacing: .06em; }
  .back h1 { font-size: 12pt; }
  .back .clauses { column-count: 2; column-gap: 6mm; font-size: 6.5pt; line-height: 1.35;
                   text-align: justify; margin-top: 3mm; }
  .back .clauses p { margin: 0 0 1.5mm; break-inside: avoid; }
`

/**
 * The page shell.
 *
 * Every document is a complete HTML document because the renderer prints
 * whatever it is handed and nothing wraps it. `lang` and `dir` are set from
 * the locale here rather than in six templates, and so is the brand: this is
 * the single point every job document passes through, which is why the tokens
 * are prepended here rather than pasted into each stylesheet.
 *
 * `documentBrandCss()` first, `DOCUMENT_CSS` after it, `extraCss` last — a
 * template's own rules must be able to override the kit's, and neither can
 * usefully override a custom property it is written in terms of.
 */
export function page(locale: DocumentLocale, body: string, extraCss = ''): string {
  return `<!doctype html>
<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}" ${PRINT_THEME_ATTR}>
<meta charset="utf-8">
<style>${documentBrandCss()}${DOCUMENT_CSS}${extraCss}</style>
${body}
</html>`
}

/**
 * The legal entity a document is issued by — what the letterhead prints.
 *
 * Narrower than `JobDocumentView` on purpose: a quotation is issued by a
 * branch and belongs to no job, and typing the letterhead against the whole
 * shipment view would have meant either inventing an empty shipment to print
 * a quote on, or a second copy of this block.
 */
export interface IssuingEntity {
  readonly branch: {
    readonly legalNameEn: string
    readonly legalNameAr: string
    readonly taxRegistration: string | null
  }
}

/** The letterhead block every document opens with. */
export function letterhead(
  view: IssuingEntity,
  title: string,
  subtitle: string,
  locale: DocumentLocale,
): string {
  const entity = locale === 'ar' ? view.branch.legalNameAr : view.branch.legalNameEn
  return `<div class="head">
  <div>
    <h1>${esc(title)}</h1>
    <div class="muted">${esc(subtitle)}</div>
  </div>
  <div class="entity">
    <strong>${esc(entity)}</strong>
    ${view.branch.taxRegistration ? `<div class="muted">${esc(view.branch.taxRegistration)}</div>` : ''}
  </div>
</div>`
}

/** A party, as it prints in a box on a bill. */
export function partyBlock(
  party: PartyView | undefined,
  heading: string,
  locale: DocumentLocale,
  fallback = '—',
): string {
  if (!party) {
    return `<div class="cell"><h2>${esc(heading)}</h2><div>${bdi(esc(fallback))}</div></div>`
  }

  const name = localised(party.nameEn, party.nameAr, locale)
  const lines = [
    party.address ? bdiBlock(party.address) : '',
    bdi([party.city, party.country].filter(Boolean).map(esc).join(', ')),
    party.contactName ? bdi(esc(party.contactName)) : '',
    [party.phone, party.email]
      .filter(Boolean)
      .map((v) => ltr(esc(v)))
      .join(' · '),
    party.taxId ? ltr(esc(party.taxId)) : '',
  ].filter((l) => l !== '')

  return `<div class="cell">
  <h2>${esc(heading)}</h2>
  <strong>${bdi(esc(name))}</strong>
  <div class="addr muted">${lines.join('<br>')}</div>
</div>`
}

/** A labelled value in a row of them. */
export function field(label: string, value: string): string {
  return `<div class="field"><span class="label">${esc(label)}</span>${value}</div>`
}
