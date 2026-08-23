/**
 * The delivery order — the most-issued document in the building.
 *
 * It is an instruction, not a contract: it tells a terminal, a depot or a
 * warehouse to hand the cargo to the named party. Which makes it the simplest
 * document here and the one worth building first — a coordinator issues
 * several a day, and every one of them was being typed into Word.
 *
 * Two things earn their place on the page.
 *
 * **A validity date.** A delivery order with no expiry is a standing
 * instruction to release somebody else's cargo, and it circulates by email and
 * WhatsApp long after the job closes. Seven days is the working default and
 * the caller may override it.
 *
 * **The release conditions, stated.** "Subject to payment of all charges" and
 * "against surrender of the original bill of lading" are the two clauses that
 * decide whether releasing the cargo was our decision or our mistake. They
 * print, every time, because the one occasion they are left off is the one
 * that ends up in a claim.
 */

import {
  cargoTotals,
  esc,
  escBlock,
  field,
  formatDate,
  formatQuantity,
  letterhead,
  localised,
  page,
  partyBlock,
  partyOf,
  type DocumentLocale,
  type JobDocumentView,
} from './document-kit'

const STRINGS = {
  en: {
    title: 'Delivery Order',
    to: 'To',
    releaseTo: 'Release cargo to',
    job: 'Our reference',
    houseBill: 'House B/L',
    masterBill: 'Master B/L',
    vessel: 'Vessel / Voyage',
    flight: 'Flight',
    arrived: 'Arrived',
    validUntil: 'Valid until',
    marks: 'Marks',
    packages: 'Packages',
    description: 'Description',
    gross: 'Gross weight (kg)',
    containers: 'Containers',
    totals: 'Totals',
    instruction:
      'Please deliver the undermentioned consignment to the party named above. This delivery order is ' +
      'issued subject to payment in full of all freight, duties and charges due to us, and against ' +
      'surrender of the original bill of lading where one has been issued. It is valid until the date ' +
      'shown and confers no right of delivery thereafter.',
    instructionSurrendered:
      'Please deliver the undermentioned consignment to the party named above. This delivery order is ' +
      'issued subject to payment in full of all freight, duties and charges due to us. The original ' +
      'bills of lading were surrendered at origin on {date} (telex release) and no original is to be ' +
      'called for. It is valid until the date shown and confers no right of delivery thereafter.',
    authorised: 'Authorised signatory',
    received: 'Received in good condition',
  },
  ar: {
    title: 'أمر تسليم',
    to: 'إلى',
    releaseTo: 'يُسلّم إلى',
    job: 'مرجعنا',
    houseBill: 'البوليصة الفرعية',
    masterBill: 'البوليصة الرئيسية',
    vessel: 'الباخرة / الرحلة',
    flight: 'رقم الرحلة',
    arrived: 'تاريخ الوصول',
    validUntil: 'صالح حتى',
    marks: 'العلامات',
    packages: 'الطرود',
    description: 'الوصف',
    gross: 'الوزن الإجمالي (كجم)',
    containers: 'الحاويات',
    totals: 'الإجمالي',
    instruction:
      'يُرجى تسليم الإرسالية المذكورة أدناه إلى الطرف المسمّى أعلاه. صدر أمر التسليم هذا مشروطاً بسداد ' +
      'كامل أجور الشحن والرسوم والمصاريف المستحقة لنا، ومقابل تسليم النسخة الأصلية من بوليصة الشحن إن ' +
      'صدرت. وهو صالح حتى التاريخ المبيّن ولا يخوّل التسليم بعده.',
    instructionSurrendered:
      'يُرجى تسليم الإرسالية المذكورة أدناه إلى الطرف المسمّى أعلاه. صدر أمر التسليم هذا مشروطاً بسداد ' +
      'كامل أجور الشحن والرسوم والمصاريف المستحقة لنا. وقد سُلّمت النسخ الأصلية من بوليصة الشحن في بلد ' +
      'المنشأ بتاريخ {date} (إفراج بالتلكس) فلا تُطلب أي نسخة أصلية. وهو صالح حتى التاريخ المبيّن ولا ' +
      'يخوّل التسليم بعده.',
    authorised: 'التوقيع المعتمد',
    received: 'استُلمت بحالة جيدة',
  },
} as const

export interface DeliveryOrderOptions {
  /** Who the terminal or depot is being addressed. */
  readonly addressedTo?: string | null
  readonly validUntil?: Date | null
  readonly validDays?: number
}

export function renderDeliveryOrderHtml(
  view: JobDocumentView,
  locale: DocumentLocale,
  options: DeliveryOrderOptions = {},
): string {
  const t = STRINGS[locale]
  const air = view.mode === 'air'
  const totals = cargoTotals(view.cargo)

  /*
    Seven days, and computed from issue rather than left blank.

    A blank expiry is the same as no expiry, and the document outlives the job
    by months in somebody's inbox.
  */
  const validUntil =
    options.validUntil ??
    new Date(view.issuedAt.getTime() + (options.validDays ?? 7) * 24 * 60 * 60 * 1000)

  const consignee = partyOf(view, 'consignee')
  const agent = partyOf(view, 'delivery_agent')

  /*
    A surrendered bill changes what the terminal is told.

    "Against surrender of the original bill of lading" on a shipment whose
    originals were handed back at origin is an instruction nobody can comply
    with — the consignee does not hold one and never will — and a terminal
    that reads it literally holds the cargo. The telex-released wording says
    so, with the date, so the release is traceable to the surrender.
  */
  const instruction = view.houseBillSurrenderedAt
    ? t.instructionSurrendered.replace(
        '{date}',
        formatDate(view.houseBillSurrenderedAt, locale),
      )
    : t.instruction

  const rows = view.cargo
    .map(
      (line) => `<tr>
    <td>${escBlock(line.marksAndNumbers) || '—'}</td>
    <td class="n">${line.packageCount ?? '—'} ${esc(line.packageType ?? '')}</td>
    <td>${escBlock(localised(line.descriptionEn, line.descriptionAr, locale))}</td>
    <td class="n">${formatQuantity(line.grossWeightKg, locale)}</td>
  </tr>`,
    )
    .join('')

  const containers = view.equipment
    .filter((e) => e.containerNo)
    .map((e) => `${esc(e.containerNo)}${e.sealNo ? ` (${esc(e.sealNo)})` : ''}`)
    .join(', ')

  return page(
    locale,
    `
${letterhead(view, t.title, view.reference, locale)}

<div class="grid">
  <div class="cell">
    <h2>${esc(t.to)}</h2>
    <strong>${esc(options.addressedTo ?? localised(agent?.nameEn, agent?.nameAr, locale) ?? '—')}</strong>
  </div>
  ${partyBlock(consignee, t.releaseTo, locale, view.customer.nameEn)}
</div>

<div class="row" style="margin-top:4mm">
  ${field(t.job, esc(view.reference))}
  ${field(t.houseBill, esc(view.houseBillNumber ?? '—'))}
  ${field(t.masterBill, esc(view.masterBillNumber ?? '—'))}
  ${field(air ? t.flight : t.vessel, esc(air ? (view.flightNumber ?? '—') : [view.vesselName, view.voyageNumber].filter(Boolean).join(' / ') || '—'))}
  ${field(t.arrived, esc(formatDate(view.eta, locale)))}
  ${field(t.validUntil, `<strong>${esc(formatDate(validUntil, locale))}</strong>`)}
</div>

${containers ? `<div class="row">${field(t.containers, containers)}</div>` : ''}

<table>
  <thead><tr>
    <th style="width:24%">${t.marks}</th>
    <th class="n" style="width:16%">${t.packages}</th>
    <th>${t.description}</th>
    <th class="n" style="width:18%">${t.gross}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td>${t.totals}</td>
    <td class="n">${totals.packages}</td>
    <td></td>
    <td class="n">${formatQuantity(totals.grossWeightKg, locale)}</td>
  </tr></tfoot>
</table>

<div class="terms">${esc(instruction)}</div>

<div class="sign">
  <div>${esc(t.authorised)}</div>
  <div>${esc(t.received)}</div>
</div>
`,
  )
}
