/**
 * The house air waybill — the same job as the bill of lading, and a different
 * document in every way that matters.
 *
 * Air was rendered by `bill-of-lading.ts` until now: an ocean bill with the
 * vessel box relabelled "Flight". That produced a page a consignee would
 * recognise and an airline would not, and it carried three assumptions that
 * are wrong in the air:
 *
 * **An air waybill is not a document of title.** A bill of lading can be
 * consigned "to order" and the cargo goes to whoever holds an original. An
 * AWB cannot. It is a receipt and evidence of the contract of carriage,
 * nothing more, and the cargo is released to the *named* consignee against
 * identification. So the ocean template's "TO ORDER" default is not a
 * harmless placeholder here — it names a consignee that no handling agent can
 * release to, and the shipment sits at the destination airport accruing
 * storage while somebody reissues the waybill. This template refuses that
 * default and says so on the face.
 *
 * **The originals are allocated, not counted.** Three, on both documents, but
 * a bill of lading prints the *number* because any one of them surrenders the
 * cargo and the other two die with it. The AWB's three have fixed
 * destinations — original 1 to the issuing carrier, original 2 travelling with
 * the goods to the consignee, original 3 to the shipper — and none of them
 * surrenders anything. Printing a count would be printing the wrong fact.
 *
 * **Liability is limited by a notice, and only if the notice is there.** The
 * Montreal Convention caps the carrier at 22 SDR per kilogramme, but the cap
 * is only available to a carrier who gave the shipper the warning. An AWB
 * without the conditions-of-contract notice on its face is an AWB where the
 * limitation argument has already been lost. It prints every time, in both
 * languages, and it is not configurable.
 *
 * ## Why the rate box says "AS AGREED"
 *
 * Original 2 travels in the pouch on the carton and is handed to the
 * consignee. On a house waybill our sell rate is not their business — and on
 * an import the consignee is frequently the shipper's customer, not ours.
 * "AS AGREED" is the trade convention for exactly this and it is what the
 * charge lines and the invoice are for. A house waybill that prints the
 * freight is a commercial disclosure, not a completeness improvement.
 *
 * ## Why NVD, NCV and XXX rather than blanks
 *
 * A blank declared-value box reads as an omission, and a handling agent may
 * refuse the waybill for it. `NVD` ("no value declared") and `NCV` ("no
 * customs value") are affirmative statements that the shipper declared
 * nothing — which is what holds liability at the Convention limit rather than
 * at a value nobody agreed. `XXX` is the same for insurance: not "we forgot",
 * but "no insurance was requested through the carrier". Blanks invite
 * somebody at the counter to fill them in.
 */

import {
  cargoTotals,
  esc,
  escBlock,
  formatDate,
  formatQuantity,
  letterhead,
  localised,
  ltr,
  page,
  partiesOf,
  partyOf,
  type DocumentLocale,
  type JobDocumentView,
} from './document-kit'

const STRINGS = {
  en: {
    title: 'House Air Waybill',
    notNegotiable: 'Not negotiable',
    shipper: "Shipper's name and address",
    consignee: "Consignee's name and address",
    consigneeRequired: 'CONSIGNEE REQUIRED',
    orderWarning:
      'An air waybill is not negotiable and cannot be consigned to order. Name the consignee ' +
      'before issuing, or the destination handling agent has nobody to release the cargo to.',
    agent: "Issuing carrier's agent — name and city",
    accounting: 'Accounting information',
    iataCode: "Agent's IATA code",
    accountNo: 'Account No.',
    departure: 'Airport of departure and requested routing',
    to: 'To',
    byFirstCarrier: 'By first carrier',
    destination: 'Airport of destination',
    flight: 'Requested flight / date',
    currency: 'Currency',
    chgsCode: 'CHGS code',
    wtval: 'WT / VAL',
    other: 'Other',
    declaredCarriage: 'Declared value for carriage',
    declaredCustoms: 'Declared value for customs',
    insurance: 'Amount of insurance',
    handling: 'Handling information',
    alsoNotify: 'Also notify',
    ourReference: 'Our reference',
    customerReference: "Customer's reference",
    masterAwb: 'Master air waybill',
    incoterm: 'Incoterm',
    pieces: 'No. of pieces RCP',
    gross: 'Gross weight',
    unit: 'kg / lb',
    rateClass: 'Rate class',
    commodity: 'Commodity item no.',
    chargeable: 'Chargeable weight',
    rateCharge: 'Rate / charge',
    total: 'Total',
    nature: 'Nature and quantity of goods (incl. dimensions or volume)',
    prepaid: 'Prepaid',
    collect: 'Collect',
    weightCharge: 'Weight charge',
    valuationCharge: 'Valuation charge',
    tax: 'Tax',
    dueAgent: 'Total other charges due agent',
    dueCarrier: 'Total other charges due carrier',
    totalPrepaid: 'Total prepaid',
    totalCollect: 'Total collect',
    asAgreed: 'AS AGREED',
    originals: 'Originals',
    original1: 'Original 1 — for issuing carrier',
    original2: 'Original 2 — for consignee, travels with the goods',
    original3: 'Original 3 — for shipper',
    draft: 'DRAFT — not a valid air waybill',
    certification:
      'The shipper certifies that the particulars on the face hereof are correct and that insofar as ' +
      'any part of the consignment contains dangerous goods, such part is properly described by name ' +
      'and is in proper condition for carriage by air according to the applicable Dangerous Goods ' +
      'Regulations.',
    signedShipper: 'Signature of shipper or his agent',
    executed: 'Executed on (date) at (place)',
    signedCarrier: 'Signature of issuing carrier or its agent',
    conditions:
      'It is agreed that the goods described herein are accepted in apparent good order and condition ' +
      '(except as noted) for carriage SUBJECT TO THE CONDITIONS OF CONTRACT ON THE REVERSE HEREOF. ' +
      "THE SHIPPER'S ATTENTION IS DRAWN TO THE NOTICE CONCERNING CARRIERS' LIMITATION OF LIABILITY. " +
      'Shipper may increase such limitation of liability by declaring a higher value for carriage and ' +
      'paying a supplemental charge if required.',
    liability:
      'Notice concerning carriers’ limitation of liability. If the carriage involves an ultimate ' +
      'destination or stop in a country other than the country of departure, the Montreal Convention ' +
      'or the Warsaw Convention may be applicable, and these conventions govern and in most cases ' +
      'limit the liability of the carrier in respect of loss of, damage or delay to cargo. The limit ' +
      'of liability is 22 SDR per kilogramme unless a higher value is declared in advance by the ' +
      'shipper and a supplementary charge is paid.',
  },
  ar: {
    title: 'بوليصة شحن جوي فرعية',
    notNegotiable: 'غير قابلة للتداول',
    shipper: 'اسم وعنوان الشاحن',
    consignee: 'اسم وعنوان المرسل إليه',
    consigneeRequired: 'يجب تحديد المرسل إليه',
    orderWarning:
      'بوليصة الشحن الجوي غير قابلة للتداول ولا يجوز إصدارها لأمر أحد. يجب تحديد اسم المرسل إليه قبل ' +
      'الإصدار، وإلا فلن يجد وكيل المناولة في مطار الوصول من يسلّمه البضاعة.',
    agent: 'وكيل الناقل المُصدِر — الاسم والمدينة',
    accounting: 'المعلومات المحاسبية',
    iataCode: 'رمز إياتا للوكيل',
    accountNo: 'رقم الحساب',
    departure: 'مطار المغادرة وخط السير المطلوب',
    to: 'إلى',
    byFirstCarrier: 'بواسطة الناقل الأول',
    destination: 'مطار الوصول',
    flight: 'الرحلة والتاريخ المطلوبان',
    currency: 'العملة',
    chgsCode: 'رمز الرسوم',
    wtval: 'الوزن / القيمة',
    other: 'رسوم أخرى',
    declaredCarriage: 'القيمة المصرّح بها للنقل',
    declaredCustoms: 'القيمة المصرّح بها للجمارك',
    insurance: 'مبلغ التأمين',
    handling: 'معلومات المناولة',
    alsoNotify: 'يُخطر أيضاً',
    ourReference: 'مرجعنا',
    customerReference: 'مرجع العميل',
    masterAwb: 'بوليصة الشحن الجوي الرئيسية',
    incoterm: 'شرط التسليم',
    pieces: 'عدد الطرود',
    gross: 'الوزن الإجمالي',
    unit: 'كجم / رطل',
    rateClass: 'فئة السعر',
    commodity: 'رقم صنف البضاعة',
    chargeable: 'الوزن الخاضع للأجرة',
    rateCharge: 'السعر / الأجرة',
    total: 'الإجمالي',
    nature: 'نوع وكمية البضاعة (شاملة الأبعاد أو الحجم)',
    prepaid: 'مدفوعة مقدماً',
    collect: 'تحصّل عند الوصول',
    weightCharge: 'أجرة الوزن',
    valuationCharge: 'أجرة القيمة',
    tax: 'الضريبة',
    dueAgent: 'إجمالي الرسوم الأخرى المستحقة للوكيل',
    dueCarrier: 'إجمالي الرسوم الأخرى المستحقة للناقل',
    totalPrepaid: 'إجمالي المدفوع مقدماً',
    totalCollect: 'إجمالي التحصيل',
    asAgreed: 'حسب الاتفاق',
    originals: 'النسخ الأصلية',
    original1: 'النسخة الأولى — للناقل المُصدِر',
    original2: 'النسخة الثانية — للمرسل إليه، تُرافق البضاعة',
    original3: 'النسخة الثالثة — للشاحن',
    draft: 'مسودة — ليست بوليصة شحن جوي صالحة',
    certification:
      'يقرّ الشاحن بصحة البيانات الواردة في هذه البوليصة، وبأن أي جزء من الإرسالية يحتوي على بضائع ' +
      'خطرة قد وُصف وصفاً صحيحاً بالاسم وهو في حالة صالحة للنقل الجوي وفقاً للوائح البضائع الخطرة ' +
      'المعمول بها.',
    signedShipper: 'توقيع الشاحن أو وكيله',
    executed: 'حُرّرت بتاريخ (التاريخ) في (المكان)',
    signedCarrier: 'توقيع الناقل المُصدِر أو وكيله',
    conditions:
      'من المتفق عليه أن البضاعة الموصوفة في هذه البوليصة قد قُبلت بحالة ظاهرية جيدة (ما لم يُذكر خلاف ' +
      'ذلك) للنقل وفقاً لشروط العقد المدوّنة على ظهر هذه البوليصة. ويُلفت انتباه الشاحن إلى الإشعار ' +
      'الخاص بحدود مسؤولية الناقل. وللشاحن أن يرفع هذا الحد بالتصريح عن قيمة أعلى للنقل ودفع الرسم ' +
      'الإضافي إن طُلب منه ذلك.',
    liability:
      'إشعار بشأن حدود مسؤولية الناقل. إذا تضمّن النقل وجهة نهائية أو محطة توقف في بلد غير بلد ' +
      'المغادرة، فقد تُطبَّق اتفاقية مونتريال أو اتفاقية وارسو، وهما تحكمان مسؤولية الناقل عن هلاك ' +
      'البضاعة أو تلفها أو تأخّرها وتحدّانها في معظم الحالات. وحدّ المسؤولية هو 22 وحدة حقوق سحب خاصة ' +
      'لكل كيلوغرام ما لم يُصرَّح مسبقاً بقيمة أعلى ويُدفع رسم إضافي.',
  },
} as const

/**
 * The boxed face of the waybill.
 *
 * An AWB is a form before it is a document — the boxes are numbered in the
 * IATA resolution and a handling agent reads them by position, so the grid is
 * load-bearing rather than decorative. Twelve columns because the standard
 * face divides into halves, thirds, quarters and sixths and twelve is the
 * first number that does all four without fractions.
 */
const AWB_CSS = `
  .awb { display: grid; grid-template-columns: repeat(12, 1fr);
         border-block-start: 1px solid var(--ink); border-inline-start: 1px solid var(--ink); }
  .awb .bx { padding: 1.5mm 2mm; min-height: 12mm;
             border-inline-end: 1px solid var(--line); border-block-end: 1px solid var(--line); }
  .awb .bx .lbl { display: block; font-size: 6.5pt; text-transform: uppercase;
                  letter-spacing: .03em; color: var(--muted); margin-block-end: .8mm; }
  .awb .bx .val { font-size: 9pt; }
  .awb .bx strong { display: block; font-size: 9.5pt; }
  .notneg { display: inline-block; padding: 1mm 3mm; border: 1.5px solid var(--ink);
            font-size: 8pt; text-transform: uppercase; letter-spacing: .1em; font-weight: 700; }
  .warn { margin: 3mm 0; padding: 2mm 3mm; border: 1.5px solid var(--brand); color: var(--brand);
          font-size: 8pt; line-height: 1.4; }
  .charges { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  .charges th, .charges td { padding: 1.5mm 2mm; border: 1px solid var(--line); font-size: 8.5pt; }
  .charges th { text-align: start; font-weight: 500; color: var(--ink);
                text-transform: none; letter-spacing: 0; border-bottom: 1px solid var(--line); }
  .charges .hd { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em;
                 color: var(--muted); text-align: center; }
  .originals { margin-top: 4mm; font-size: 7.5pt; color: var(--muted); line-height: 1.5; }
`

/** One box on the face. `span` is in twelfths. */
function box(label: string, value: string, span: number): string {
  return `<div class="bx" style="grid-column: span ${span}">
  <span class="lbl">${esc(label)}</span>
  <div class="val">${value}</div>
</div>`
}

/**
 * A party as it prints inside a face box.
 *
 * `partyBlock` from the kit renders the `.cell` shape the ocean documents use;
 * the AWB grid needs the same content in its own box, so the markup is rebuilt
 * here rather than the kit being bent to serve two grids.
 */
function partyBox(
  view: JobDocumentView,
  role: Parameters<typeof partyOf>[1],
  label: string,
  locale: DocumentLocale,
  span: number,
  fallback: string,
): string {
  const party = partyOf(view, role)
  if (!party) return box(label, `<strong>${esc(fallback)}</strong>`, span)

  const lines = [
    party.address ? escBlock(party.address) : '',
    [party.city, party.country].filter(Boolean).map(esc).join(', '),
    party.contactName ? esc(party.contactName) : '',
    [party.phone, party.email].filter(Boolean).map((v) => ltr(esc(v))).join(' · '),
  ].filter((l) => l !== '')

  return box(
    label,
    `<strong>${esc(localised(party.nameEn, party.nameAr, locale))}</strong>
     <div class="muted">${lines.join('<br>')}</div>`,
    span,
  )
}

export interface AirWaybillOptions {
  /**
   * The rate class printed in the rate box.
   *
   * `Q` is the quantity rate almost every forwarder consignment moves on and
   * `M` is the minimum charge. The loader derives it from which side of the
   * chargeable-weight calculation won, so this override exists for the
   * consignments that carry a specification rate (`C`) or a class rate
   * (`S`/`R`) — rare, and not something to infer from a weight.
   */
  readonly rateClass?: string
}

export function renderAirWaybillHtml(
  view: JobDocumentView,
  locale: DocumentLocale,
  options: AirWaybillOptions = {},
): string {
  const t = STRINGS[locale]
  const totals = cargoTotals(view.cargo)

  const consignee = partyOf(view, 'consignee')
  const notify = partiesOf(view, 'notify')
  const agent = partyOf(view, 'delivery_agent')

  /*
    An order consignee is a defect on this document, not a style choice.

    The ocean template defaults an absent consignee to "TO ORDER" because a
    bill of lading works that way. Carried onto a waybill it names a party the
    destination handling agent cannot release to, and the first anybody hears
    of it is a storage bill. Caught here rather than at the airport.
  */
  const consigneeName = consignee ? localised(consignee.nameEn, consignee.nameAr, locale) : ''
  const consignedToOrder = /^\s*to\s+order/i.test(consigneeName) || /لأمر/.test(consigneeName)

  const place = (p: JobDocumentView['origin']): string =>
    p ? esc(`${localised(p.nameEn, p.nameAr, locale)}${p.unlocode ? ` (${p.unlocode})` : ''}`) : '—'

  /*
    One rate line, not one per cargo line.

    The chargeable weight is a property of the consignment — the greater of its
    actual and volumetric weight, decided once — so a per-line chargeable
    column would have to invent a split that was never rated. Real waybills
    carry a second rate line only where a genuinely different rate class
    applies. The per-line breakdown lives on the packing list, which is the
    document that exists to carry it.
  */
  const nature = view.cargo
    .map((line) => {
      const description = escBlock(localised(line.descriptionEn, line.descriptionAr, locale))
      const volume =
        line.volumeCbm && Number(line.volumeCbm) > 0
          ? ` <span class="muted">${ltr(`(${formatQuantity(line.volumeCbm, locale)} cbm)`)}</span>`
          : ''
      return `${description}${volume}`
    })
    .join('<br>')

  /*
    The airline is the prefix of the flight number, because that is the only
    place we hold it.

    `KU 172` is Kuwait Airways' designator and its flight; the two-character
    prefix is the IATA airline code by construction. A carrier partner on the
    job would be the better source and there is no column for one, so this
    reads what exists rather than leaving the box empty — and prints an em dash
    where the flight number is absent rather than guessing.
  */
  const firstCarrier = view.flightNumber?.trim().match(/^[A-Z0-9]{2,3}/)?.[0] ?? '—'

  // `K` is the IATA unit code for kilogrammes. The box is one character wide on
  // a printed waybill and the letter is what a handling agent expects in it.
  const rateClass = options.rateClass ?? (view.chargeableBasis === 'minimum' ? 'M' : 'Q')

  const handling = [
    notify.length > 0
      ? `${esc(t.alsoNotify)}: ${notify.map((p) => esc(localised(p.nameEn, p.nameAr, locale))).join('; ')}`
      : '',
    agent ? `${esc(t.alsoNotify)}: ${esc(localised(agent.nameEn, agent.nameAr, locale))}` : '',
    view.incoterm ? `${esc(t.incoterm)}: ${esc(view.incoterm)}` : '',
    view.masterBillNumber ? `${esc(t.masterAwb)}: ${ltr(esc(view.masterBillNumber))}` : '',
  ]
    .filter((l) => l !== '')
    .join('<br>')

  const prepaid = view.freightTerm === 'prepaid'
  /** The charge sits in one column and the other is struck through, never blank. */
  const charge = (row: string): string =>
    `<tr><th>${esc(row)}</th><td class="n">${prepaid ? t.asAgreed : '—'}</td><td class="n">${prepaid ? '—' : t.asAgreed}</td></tr>`

  const draft = view.houseBillNumber ? '' : `<div class="draft">${t.draft}</div>`

  return page(
    locale,
    `
${draft}

${letterhead(view, t.title, view.houseBillNumber ?? view.reference, locale)}

<div style="margin-bottom:3mm"><span class="notneg">${esc(t.notNegotiable)}</span></div>

${consignedToOrder ? `<div class="warn">${esc(t.orderWarning)}</div>` : ''}

<div class="awb">
  ${partyBox(view, 'shipper', t.shipper, locale, 6, view.customer.nameEn)}
  ${partyBox(view, 'consignee', t.consignee, locale, 6, t.consigneeRequired)}

  ${box(t.agent, `<strong>${esc(locale === 'ar' ? view.branch.legalNameAr : view.branch.legalNameEn)}</strong><div class="muted">${esc(view.placeOfIssue)}</div>`, 6)}
  ${box(t.iataCode, '—', 3)}
  ${box(t.accountNo, esc(view.customerReference ?? '—'), 3)}

  ${box(t.departure, place(view.origin), 6)}
  ${box(t.accounting, `${esc(t.ourReference)}: ${esc(view.reference)}`, 6)}

  ${box(t.to, esc(view.destination?.unlocode ?? '—'), 2)}
  ${box(t.byFirstCarrier, esc(firstCarrier), 2)}
  ${box(t.destination, place(view.destination), 4)}
  ${box(t.flight, `${ltr(esc(view.flightNumber ?? '—'))} · ${esc(formatDate(view.etd, locale))}`, 4)}

  ${box(t.currency, esc(view.currency ?? '—'), 2)}
  ${box(t.chgsCode, prepaid ? 'PP' : 'CC', 2)}
  ${box(t.wtval, `<strong>${esc(prepaid ? t.prepaid : t.collect)}</strong>`, 2)}
  ${box(t.other, `<strong>${esc(prepaid ? t.prepaid : t.collect)}</strong>`, 2)}
  ${box(t.declaredCarriage, '<strong>NVD</strong>', 2)}
  ${box(t.declaredCustoms, '<strong>NCV</strong>', 2)}

  ${box(t.insurance, '<strong>XXX</strong>', 3)}
  ${box(t.handling, handling || '—', 9)}
</div>

<table>
  <thead><tr>
    <th class="n" style="width:9%">${t.pieces}</th>
    <th class="n" style="width:12%">${t.gross}</th>
    <th style="width:6%">${t.unit}</th>
    <th style="width:8%">${t.rateClass}</th>
    <th style="width:10%">${t.commodity}</th>
    <th class="n" style="width:13%">${t.chargeable}</th>
    <th class="n" style="width:12%">${t.rateCharge}</th>
    <th class="n" style="width:10%">${t.total}</th>
  </tr></thead>
  <tbody>
    <tr>
      <td class="n">${totals.packages}</td>
      <td class="n">${formatQuantity(totals.grossWeightKg, locale)}</td>
      <td>K</td>
      <td>${esc(rateClass)}</td>
      <td>—</td>
      <td class="n">${formatQuantity(view.chargeableWeightKg, locale)}</td>
      <td class="n">${esc(t.asAgreed)}</td>
      <td class="n">${esc(t.asAgreed)}</td>
    </tr>
    <tr>
      <td colspan="8">
        <span class="muted" style="font-size:7.5pt">${esc(t.nature)}</span><br>
        ${nature || '—'}
      </td>
    </tr>
  </tbody>
</table>

<table class="charges">
  <thead><tr>
    <th style="width:52%"></th>
    <th class="hd">${t.prepaid}</th>
    <th class="hd">${t.collect}</th>
  </tr></thead>
  <tbody>
    ${charge(t.weightCharge)}
    <tr><th>${esc(t.valuationCharge)}</th><td class="n">—</td><td class="n">—</td></tr>
    <tr><th>${esc(t.tax)}</th><td class="n">—</td><td class="n">—</td></tr>
    ${charge(t.dueAgent)}
    ${charge(t.dueCarrier)}
    <tr>
      <th>${esc(prepaid ? t.totalPrepaid : t.totalCollect)}</th>
      <td class="n">${prepaid ? t.asAgreed : '—'}</td>
      <td class="n">${prepaid ? '—' : t.asAgreed}</td>
    </tr>
  </tbody>
</table>

<div class="terms">${esc(t.certification)}</div>

<div class="sign">
  <div>${esc(t.signedShipper)}</div>
  <div>${esc(t.executed)}: ${esc(formatDate(view.issuedAt, locale))} · ${esc(view.placeOfIssue)}<br>${esc(t.signedCarrier)}</div>
</div>

<div class="originals">
  <strong>${esc(t.originals)}</strong><br>
  ${esc(t.original1)}<br>
  ${esc(t.original2)}<br>
  ${esc(t.original3)}
</div>

<div class="terms">${esc(t.conditions)}</div>
<div class="terms">${esc(t.liability)}</div>
`,
    AWB_CSS,
  )
}
