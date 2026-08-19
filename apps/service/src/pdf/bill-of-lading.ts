/**
 * The house bill of lading — the document with legal weight on it.
 *
 * Everything else this system prints is a record of something. A bill of
 * lading *is* the thing: it is the contract of carriage, the receipt for the
 * goods, and — when it is not marked otherwise — a document of title, meaning
 * whoever holds the original can claim the cargo. That is why the two rules
 * below are not stylistic.
 *
 * **The description is printed verbatim.** The carrier receives sealed cartons
 * and cannot verify what is inside them, so it prints what the shipper
 * declared and disclaims it — the phrase of art is "said to contain", and it
 * appears on the face of every bill in the trade. Nothing on this page
 * "improves" the shipper's wording, resolves it against the commodity table,
 * or corrects a spelling. A discrepancy between the bill and the carton is the
 * shipper's; a discrepancy introduced by us is ours.
 *
 * **An unnumbered bill is watermarked, never quietly issued.** `series_no` on
 * an invoice has an exact analogue here: until a house bill number is
 * allocated the document is a draft, and a draft that looks like an original
 * is how a consignee ends up holding something a bank will not accept.
 *
 * ## Originals
 *
 * Three originals is the convention, and the count prints on the face because
 * the carrier releases against *any one* of them and the other two become
 * void. A bill that does not say how many originals exist cannot be safely
 * surrendered.
 *
 * ## Ocean only
 *
 * This template used to serve air as well, by retitling itself and swapping
 * the vessel box for a flight number. That was wrong in the way a document is
 * wrong rather than the way code is: an air waybill is not a document of
 * title, cannot be consigned to order, and limits liability by a notice this
 * page does not carry. `air-waybill.ts` is the real one and `job-documents.ts`
 * routes to it on mode.
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
  partiesOf,
  partyBlock,
  partyOf,
  type DocumentLocale,
  type JobDocumentView,
} from './document-kit'

const STRINGS = {
  en: {
    title: 'House Bill of Lading',
    shipper: 'Shipper / Exporter',
    consignee: 'Consignee',
    notify: 'Notify party',
    agent: 'Delivery agent',
    carrier: 'Vessel / Voyage',
    portLoad: 'Port of loading',
    portDischarge: 'Port of discharge',
    booking: 'Booking',
    masterBill: 'Master B/L',
    marks: 'Marks and numbers',
    packages: 'No. of pkgs',
    description: 'Description of goods (said to contain)',
    gross: 'Gross weight (kg)',
    measure: 'Measurement (cbm)',
    totals: 'Totals',
    freight: 'Freight',
    prepaid: 'Prepaid',
    collect: 'Collect',
    originals: 'Number of original B/L',
    place: 'Place and date of issue',
    containers: 'Container / Seal',
    draft: 'DRAFT — not a valid bill of lading',
    condition:
      'Received in apparent good order and condition, unless otherwise stated, the goods described above, ' +
      'weight, measure, marks, numbers, quality, contents and value unknown, for carriage to the port of ' +
      'discharge or so near thereto as the vessel may safely get and lie always afloat. In accepting this ' +
      'bill of lading the merchant expressly accepts and agrees to all its terms whether printed, stamped ' +
      'or written. In witness whereof the number of original bills of lading stated above has been signed, ' +
      'one of which being accomplished the others to stand void.',
    signedFor: 'Signed for the carrier',
    signedShipper: 'Shipper or agent',
  },
  ar: {
    title: 'بوليصة شحن فرعية',
    shipper: 'الشاحن / المصدّر',
    consignee: 'المرسل إليه',
    notify: 'الطرف المُخطَر',
    agent: 'وكيل التسليم',
    carrier: 'الباخرة / الرحلة',
    portLoad: 'ميناء الشحن',
    portDischarge: 'ميناء التفريغ',
    booking: 'رقم الحجز',
    masterBill: 'البوليصة الرئيسية',
    marks: 'العلامات والأرقام',
    packages: 'عدد الطرود',
    description: 'وصف البضاعة (حسب إفادة الشاحن)',
    gross: 'الوزن الإجمالي (كجم)',
    measure: 'الحجم (متر مكعب)',
    totals: 'الإجمالي',
    freight: 'أجرة الشحن',
    prepaid: 'مدفوعة مقدماً',
    collect: 'تحصّل عند الوصول',
    originals: 'عدد النسخ الأصلية',
    place: 'مكان وتاريخ الإصدار',
    containers: 'الحاوية / الرصاص',
    draft: 'مسودة — ليست بوليصة شحن صالحة',
    condition:
      'استُلمت البضاعة الموصوفة أعلاه بحالة ظاهرية جيدة ما لم يُذكر خلاف ذلك، والوزن والقياس والعلامات ' +
      'والأرقام والنوع والمحتويات والقيمة غير معلومة، لنقلها إلى ميناء التفريغ. وبقبول هذه البوليصة يوافق ' +
      'التاجر صراحةً على جميع شروطها المطبوعة أو المختومة أو المكتوبة. وقد وُقّع العدد المذكور أعلاه من ' +
      'النسخ الأصلية، ومتى نُفّذت إحداها سقطت البقية.',
    signedFor: 'التوقيع عن الناقل',
    signedShipper: 'الشاحن أو وكيله',
  },
} as const

export interface BillOfLadingOptions {
  /** Three is the convention. Printed on the face because it has to be. */
  readonly originals?: number
}

export function renderBillOfLadingHtml(
  view: JobDocumentView,
  locale: DocumentLocale,
  options: BillOfLadingOptions = {},
): string {
  const t = STRINGS[locale]
  const originals = options.originals ?? 3
  const totals = cargoTotals(view.cargo)

  const shipper = partyOf(view, 'shipper')
  const consignee = partyOf(view, 'consignee')
  const notify = partiesOf(view, 'notify')
  const agent = partyOf(view, 'delivery_agent')

  const place = (p: JobDocumentView['origin']): string =>
    p ? esc(`${localised(p.nameEn, p.nameAr, locale)}${p.unlocode ? ` (${p.unlocode})` : ''}`) : '—'

  /*
    The cargo block, printed verbatim.

    `escBlock` rather than `esc` on the marks: line breaks in marks and numbers
    are what match the stencilling on the carton, and collapsing them into a
    paragraph is a discrepancy somebody argues about at the port.
  */
  const rows = view.cargo
    .map(
      (line) => `<tr>
    <td>${escBlock(line.marksAndNumbers) || '—'}${line.containerNo ? `<br><span class="muted">${esc(line.containerNo)}</span>` : ''}</td>
    <td class="n">${line.packageCount ?? '—'}${line.packageType ? `<br><span class="muted">${esc(line.packageType)}</span>` : ''}</td>
    <td>${escBlock(localised(line.descriptionEn, line.descriptionAr, locale))}</td>
    <td class="n">${formatQuantity(line.grossWeightKg, locale)}</td>
    <td class="n">${formatQuantity(line.volumeCbm, locale)}</td>
  </tr>`,
    )
    .join('')

  const containers = view.equipment
    .filter((e) => e.containerNo)
    .map(
      (e) =>
        `${esc(e.containerNo)}${e.containerType ? ` / ${esc(e.containerType)}` : ''}${e.sealNo ? ` / ${esc(e.sealNo)}` : ''}`,
    )
    .join('<br>')

  const draft = view.houseBillNumber ? '' : `<div class="draft">${t.draft}</div>`

  return page(
    locale,
    `
${draft}

${letterhead(view, t.title, view.houseBillNumber ?? view.reference, locale)}

<div class="grid">
  ${partyBlock(shipper, t.shipper, locale, view.customer.nameEn)}
  ${partyBlock(consignee, t.consignee, locale, 'TO ORDER')}
  ${partyBlock(notify[0], t.notify, locale, 'SAME AS CONSIGNEE')}
  ${partyBlock(notify[1] ?? agent, notify[1] ? t.notify : t.agent, locale)}
</div>

<div class="row" style="margin-top:4mm">
  ${field(t.carrier, esc([view.vesselName, view.voyageNumber].filter(Boolean).join(' / ') || '—'))}
  ${field(t.portLoad, place(view.origin))}
  ${field(t.portDischarge, place(view.destination))}
  ${field(t.booking, esc(view.bookingNumber ?? '—'))}
  ${field(t.masterBill, esc(view.masterBillNumber ?? '—'))}
</div>

${containers ? `<div class="row">${field(t.containers, containers)}</div>` : ''}

<table>
  <thead><tr>
    <th style="width:22%">${t.marks}</th>
    <th class="n" style="width:12%">${t.packages}</th>
    <th>${t.description}</th>
    <th class="n" style="width:14%">${t.gross}</th>
    <th class="n" style="width:12%">${t.measure}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr>
    <td>${t.totals}</td>
    <td class="n">${totals.packages}</td>
    <td></td>
    <td class="n">${formatQuantity(totals.grossWeightKg, locale)}</td>
    <td class="n">${formatQuantity(totals.volumeCbm, locale)}</td>
  </tr></tfoot>
</table>

<div class="row" style="margin-top:4mm">
  ${field(t.freight, `<span class="stamp">${view.freightTerm === 'prepaid' ? t.prepaid : t.collect}</span>`)}
  ${field(t.originals, esc(String(originals)))}
  ${field(t.place, `${esc(view.placeOfIssue)} · ${esc(formatDate(view.issuedAt, locale))}`)}
</div>

<div class="terms">${esc(t.condition)}</div>

<div class="sign">
  <div>${esc(t.signedShipper)}</div>
  <div>${esc(t.signedFor)}</div>
</div>
`,
  )
}
