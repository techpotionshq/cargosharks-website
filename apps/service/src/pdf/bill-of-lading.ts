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
 * ## What a bank reads
 *
 * Most house bills are presented under a letter of credit, and the bank
 * examines them against UCP 600 article 20. Four things on this page exist
 * because of that article and would look like decoration without it:
 *
 * - **The on-board notation.** The date of issue is taken as the date of
 *   shipment *unless* the bill says when the goods went on board, and a credit
 *   that calls for a shipped bill — nearly all of them — rejects one that only
 *   says "received". The date is the `loaded` milestone where there is one and
 *   the vessel's departure where there is not; the loader says so. Where
 *   neither is known the bill says "received for shipment" in that box, which
 *   is a true statement a bank can act on, rather than a date we invented.
 * - **Originals and copies as separate sheets.** The carrier releases against
 *   *any one* original and the others become void, so each original says
 *   which of the set it is, and a copy says on its face that it is not one of
 *   them. One sheet that says "3 originals" and is printed three times is
 *   three documents that each claim to be all of them.
 * - **The terms on the reverse.** The face says the merchant "agrees to all
 *   its terms whether printed, stamped or written". The printed terms are the
 *   branch's `bill_of_lading_terms`, and they follow every face sheet so that
 *   a duplex print puts them on its back.
 * - **The surrender stamp.** A telex release is the originals handed back at
 *   origin so the destination agent releases without them — common enough in
 *   Gulf trade to be the normal case on some lanes. A surrendered bill prints
 *   no original pages at all, because there are none any more, and every copy
 *   carries the stamp and the date.
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
  bdi,
  bdiBlock,
  cargoTotals,
  esc,
  field,
  formatDate,
  formatQuantity,
  letterhead,
  localised,
  ltr,
  page,
  paragraphs,
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
    placeReceipt: 'Place of receipt',
    portLoad: 'Port of loading',
    portDischarge: 'Port of discharge',
    placeDelivery: 'Place of delivery',
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
    freightPayableAt: 'Freight payable at',
    originals: 'Number of original B/L',
    place: 'Place and date of issue',
    containers: 'Container / Seal',
    onBoard: 'On-board notation',
    shippedOnBoard: 'Shipped on board',
    receivedForShipment: 'Received for shipment — not yet on board',
    original: 'Original',
    of: 'of',
    copy: 'Copy — non-negotiable',
    surrendered: 'Surrendered',
    telexRelease: 'Telex release',
    draft: 'DRAFT — not a valid bill of lading',
    condition:
      'Received in apparent good order and condition, unless otherwise stated, the goods described above, ' +
      'weight, measure, marks, numbers, quality, contents and value unknown, for carriage to the port of ' +
      'discharge or so near thereto as the vessel may safely get and lie always afloat. In accepting this ' +
      'bill of lading the merchant expressly accepts and agrees to all its terms whether printed, stamped ' +
      'or written. In witness whereof the number of original bills of lading stated above has been signed, ' +
      'one of which being accomplished the others to stand void.',
    reverse: 'The terms and conditions printed on the reverse side form part of this bill of lading.',
    signedFor: 'Signed for the carrier',
    signedShipper: 'Shipper or agent',
    termsTitle: 'Terms and conditions of carriage',
    termsSubtitle: 'Reverse side of house bill of lading',
  },
  ar: {
    title: 'بوليصة شحن فرعية',
    shipper: 'الشاحن / المصدّر',
    consignee: 'المرسل إليه',
    notify: 'الطرف المُخطَر',
    agent: 'وكيل التسليم',
    carrier: 'الباخرة / الرحلة',
    placeReceipt: 'مكان الاستلام',
    portLoad: 'ميناء الشحن',
    portDischarge: 'ميناء التفريغ',
    placeDelivery: 'مكان التسليم',
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
    freightPayableAt: 'أجرة الشحن تُدفع في',
    originals: 'عدد النسخ الأصلية',
    place: 'مكان وتاريخ الإصدار',
    containers: 'الحاوية / الرصاص',
    onBoard: 'إشعار الشحن على متن الباخرة',
    shippedOnBoard: 'شُحنت على متن الباخرة',
    receivedForShipment: 'استُلمت للشحن — لم تُشحن على المتن بعد',
    original: 'نسخة أصلية',
    of: 'من',
    copy: 'نسخة — غير قابلة للتداول',
    surrendered: 'مُسلَّمة',
    telexRelease: 'إفراج بالتلكس',
    draft: 'مسودة — ليست بوليصة شحن صالحة',
    condition:
      'استُلمت البضاعة الموصوفة أعلاه بحالة ظاهرية جيدة ما لم يُذكر خلاف ذلك، والوزن والقياس والعلامات ' +
      'والأرقام والنوع والمحتويات والقيمة غير معلومة، لنقلها إلى ميناء التفريغ. وبقبول هذه البوليصة يوافق ' +
      'التاجر صراحةً على جميع شروطها المطبوعة أو المختومة أو المكتوبة. وقد وُقّع العدد المذكور أعلاه من ' +
      'النسخ الأصلية، ومتى نُفّذت إحداها سقطت البقية.',
    reverse: 'تُعدّ الشروط والأحكام المدوّنة على ظهر هذه البوليصة جزءاً لا يتجزأ منها.',
    signedFor: 'التوقيع عن الناقل',
    signedShipper: 'الشاحن أو وكيله',
    termsTitle: 'شروط وأحكام النقل',
    termsSubtitle: 'ظهر بوليصة الشحن الفرعية',
  },
} as const

export interface BillOfLadingOptions {
  /**
   * Three is the convention. Printed on the face because it has to be, and
   * each original sheet says which of the set it is.
   */
  readonly originals?: number
  /** Non-negotiable copies, for the file, the agent and the broker. */
  readonly copies?: number
}

/** One face sheet of the set — which counterpart it is. */
type Counterpart = { readonly kind: 'original'; readonly index: number } | { readonly kind: 'copy' }

export function renderBillOfLadingHtml(
  view: JobDocumentView,
  locale: DocumentLocale,
  options: BillOfLadingOptions = {},
): string {
  const t = STRINGS[locale]
  const originals = options.originals ?? 3
  const copies = options.copies ?? 3
  const surrendered = view.houseBillSurrenderedAt !== null

  /*
    The set.

    A surrendered bill has no originals — they were collected, which is the
    whole meaning of the word — so it prints copies only, each carrying the
    stamp. Printing the original sheets with a stamp across them would hand a
    consignee three pages that say ORIGINAL and SURRENDERED at once, and a
    bank reads the first word.
  */
  const counterparts: Counterpart[] = surrendered
    ? Array.from({ length: Math.max(1, copies) }, () => ({ kind: 'copy' }) as const)
    : [
        ...Array.from(
          { length: originals },
          (_, i) => ({ kind: 'original', index: i + 1 }) as const,
        ),
        ...Array.from({ length: copies }, () => ({ kind: 'copy' }) as const),
      ]

  const terms = localised(view.branch.billOfLadingTermsEn, view.branch.billOfLadingTermsAr, locale)

  const face = renderFace(view, locale, originals, terms !== '')
  const back = terms ? renderBack(view, locale, terms) : ''

  const sheets = counterparts
    .map((counterpart) => {
      const label =
        counterpart.kind === 'original'
          ? `<div class="counterpart">${esc(t.original)} ${counterpart.index} ${esc(t.of)} ${originals}</div>`
          : `<div class="counterpart copy">${esc(t.copy)}</div>`

      const stamp = surrendered
        ? `<div class="surrendered"><span>${esc(t.surrendered)}<small>${esc(t.telexRelease)} · ${esc(formatDate(view.houseBillSurrenderedAt, locale))}</small></span></div>`
        : ''

      /*
        Face, then back, for every sheet.

        Duplex printing takes pages in pairs, so the terms have to follow each
        face rather than appear once at the end of the set — otherwise the
        first original gets the terms of the second on its reverse and the
        last copy gets a blank.
      */
      return `<div class="sheet face">${label}${stamp}${face}</div>${back}`
    })
    .join('')

  /*
    `.draft` is `position: fixed`, and Chromium repeats a fixed element on
    every printed page — which is the behaviour wanted here, since a draft is
    a draft on each of its six sheets.
  */
  const draft = view.houseBillNumber ? '' : `<div class="draft">${t.draft}</div>`

  return page(locale, `${draft}${sheets}`)
}

function renderFace(
  view: JobDocumentView,
  locale: DocumentLocale,
  originals: number,
  hasReverse: boolean,
): string {
  const t = STRINGS[locale]
  const totals = cargoTotals(view.cargo)

  const shipper = partyOf(view, 'shipper')
  const consignee = partyOf(view, 'consignee')
  const notify = partiesOf(view, 'notify')
  const agent = partyOf(view, 'delivery_agent')

  const place = (p: JobDocumentView['origin']): string =>
    p
      ? bdi(esc(localised(p.nameEn, p.nameAr, locale))) + (p.unlocode ? ` ${ltr(esc(p.unlocode))}` : '')
      : '—'

  /*
    The cargo block, printed verbatim.

    `bdiBlock` rather than `esc` on the marks: line breaks in marks and
    numbers are what match the stencilling on the carton, and collapsing them
    into a paragraph is a discrepancy somebody argues about at the port. Each
    line is isolated on its own because marks are Latin on an Arabic face as
    often as not.
  */
  const rows = view.cargo
    .map(
      (line) => `<tr>
    <td>${bdiBlock(line.marksAndNumbers) || '—'}${line.containerNo ? `<br><span class="muted">${ltr(esc(line.containerNo))}</span>` : ''}</td>
    <td class="n">${line.packageCount ?? '—'}${line.packageType ? `<br><span class="muted">${bdi(esc(line.packageType))}</span>` : ''}</td>
    <td>${bdiBlock(localised(line.descriptionEn, line.descriptionAr, locale))}</td>
    <td class="n">${formatQuantity(line.grossWeightKg, locale)}</td>
    <td class="n">${formatQuantity(line.volumeCbm, locale)}</td>
  </tr>`,
    )
    .join('')

  const containers = view.equipment
    .filter((e) => e.containerNo)
    .map((e) =>
      ltr(
        `${esc(e.containerNo)}${e.containerType ? ` / ${esc(e.containerType)}` : ''}${e.sealNo ? ` / ${esc(e.sealNo)}` : ''}`,
      ),
    )
    .join('<br>')

  const vessel = [view.vesselName, view.voyageNumber].filter(Boolean).join(' / ')

  /*
    The on-board notation — see the file comment for why a bank cares.

    The vessel is named in the notation as well as in its own box. Article 20
    only demands it where the box says "intended vessel", which ours never
    does, but a notation that names the ship is what every carrier's form
    prints and what a document checker expects to find in that position.
  */
  const onBoard = view.shippedOnBoardAt
    ? `<span class="stamp">${esc(t.shippedOnBoard)}</span> ${vessel ? `${ltr(esc(vessel))} · ` : ''}${esc(formatDate(view.shippedOnBoardAt, locale))}`
    : `<span class="muted">${esc(t.receivedForShipment)}</span>`

  /*
    Where the freight is paid is the same fact as whether it is prepaid: at
    the port of loading if so, at the port of discharge if collect. Derived,
    because a typed box that disagreed with the stamp beside it would be the
    bill arguing with itself.
  */
  const freightPayableAt = place(view.freightTerm === 'prepaid' ? view.origin : view.destination)

  return `
${letterhead(view, t.title, view.houseBillNumber ?? view.reference, locale)}

<div class="grid">
  ${partyBlock(shipper, t.shipper, locale, view.customer.nameEn)}
  ${partyBlock(consignee, t.consignee, locale, 'TO ORDER')}
  ${partyBlock(notify[0], t.notify, locale, 'SAME AS CONSIGNEE')}
  ${partyBlock(notify[1] ?? agent, notify[1] ? t.notify : t.agent, locale)}
</div>

<div class="row even" style="margin-top:4mm">
  ${field(t.placeReceipt, view.placeOfReceipt ? bdiBlock(view.placeOfReceipt) : '—')}
  ${field(t.portLoad, place(view.origin))}
  ${field(t.carrier, vessel ? ltr(esc(vessel)) : '—')}
  ${field(t.portDischarge, place(view.destination))}
  ${field(t.placeDelivery, view.placeOfDelivery ? bdiBlock(view.placeOfDelivery) : '—')}
</div>

<div class="row">
  ${field(t.booking, view.bookingNumber ? ltr(esc(view.bookingNumber)) : '—')}
  ${field(t.masterBill, view.masterBillNumber ? ltr(esc(view.masterBillNumber)) : '—')}
  ${containers ? field(t.containers, containers) : ''}
</div>

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

<div class="row even" style="margin-top:4mm">
  ${field(t.freight, `<span class="stamp">${view.freightTerm === 'prepaid' ? t.prepaid : t.collect}</span>`)}
  ${field(t.freightPayableAt, freightPayableAt)}
  ${field(t.originals, esc(String(originals)))}
  ${field(t.place, `${ltr(esc(view.placeOfIssue))} · ${esc(formatDate(view.issuedAt, locale))}`)}
</div>

<div class="row">
  ${field(t.onBoard, onBoard)}
</div>

<div class="terms">${esc(t.condition)}${hasReverse ? ` ${esc(t.reverse)}` : ''}</div>

<div class="sign">
  <div>${esc(t.signedShipper)}</div>
  <div>${esc(t.signedFor)}</div>
</div>
`
}

/**
 * The reverse side.
 *
 * Two columns at a small size, because that is what the back of a bill looks
 * like and because the clauses have to fit one sheet for the duplex pairing
 * above to hold. The bill's number is repeated at the top so a back separated
 * from its face can be matched to it.
 */
function renderBack(view: JobDocumentView, locale: DocumentLocale, terms: string): string {
  const t = STRINGS[locale]
  return `<div class="sheet back">
  <div class="head">
    <div>
      <h1>${esc(t.termsTitle)}</h1>
      <div class="muted">${esc(t.termsSubtitle)} · ${ltr(esc(view.houseBillNumber ?? view.reference))}</div>
    </div>
    <div class="entity"><strong>${esc(locale === 'ar' ? view.branch.legalNameAr : view.branch.legalNameEn)}</strong></div>
  </div>
  <div class="clauses">${paragraphs(terms)}</div>
</div>`
}
