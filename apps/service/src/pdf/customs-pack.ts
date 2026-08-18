/**
 * The declaration pack — everything the broker types, on one sheet.
 *
 * We do not file. Kuwait customs runs on a concession held through a joint
 * venture majority-owned by a competitor until 2030, and `adapters/customs.ts`
 * refuses to pretend otherwise. That is a fact about the market.
 *
 * It is not a reason to leave the broker reading three documents and a WhatsApp
 * thread to assemble the twelve fields a declaration actually needs. The
 * filing click is thirty seconds; the retyping is the hour. This is that hour,
 * removed, without a single line of integration.
 *
 * The estimate prints beside it, marked as an estimate, with the tariff line
 * that produced each number. A broker who disagrees with 7% can see that it
 * came from prefix 870323 effective January 2025 and say so — which is a
 * conversation, where a bare figure is an argument.
 */

import {
  esc,
  escBlock,
  field,
  formatDate,
  formatMoney,
  formatQuantity,
  letterhead,
  localised,
  page,
  partyBlock,
  partyOf,
  type DocumentLocale,
  type JobDocumentView,
} from './document-kit'

export interface CustomsPackLineView {
  readonly lineNo: number
  readonly description: string
  readonly hsCode: string | null
  readonly matchedPrefix: string | null
  readonly ratePercent: string | null
  readonly packageCount: number | null
  readonly grossWeightKg: string | null
  readonly netWeightKg: string | null
  readonly value: string | null
  readonly duty: string | null
  readonly countryOfOrigin: string | null
}

export interface CustomsPackView {
  readonly job: JobDocumentView
  readonly declarationType: string | null
  readonly declarationNo: string | null
  readonly brokerName: string | null
  readonly currency: string
  readonly goodsValue: string | null
  readonly freightValue: string | null
  readonly insuranceValue: string | null
  readonly customsValue: string | null
  readonly estimatedDuty: string | null
  readonly estimatedAt: Date | null
  readonly lines: readonly CustomsPackLineView[]
  /** Codes the tariff had no row for — printed, because they are the work. */
  readonly unmatched: readonly string[]
}

const STRINGS = {
  en: {
    title: 'Customs Declaration Pack',
    subtitle: 'Working document — prepared for the clearing agent',
    importer: 'Importer of record',
    supplier: 'Supplier / Shipper',
    broker: 'Clearing agent',
    shipment: 'Shipment',
    houseBill: 'House B/L',
    masterBill: 'Master B/L',
    vessel: 'Vessel / Voyage',
    flight: 'Flight',
    arrival: 'Arrival',
    origin: 'Country of origin',
    load: 'Port of loading',
    discharge: 'Port of discharge',
    incoterm: 'Incoterm',
    declarationType: 'Declaration type',
    declarationNo: 'Declaration no.',
    line: '#',
    description: 'Description of goods',
    hs: 'HS code',
    packages: 'Pkgs',
    net: 'Net (kg)',
    gross: 'Gross (kg)',
    value: 'Value',
    rate: 'Rate',
    duty: 'Duty (est.)',
    countryOrigin: 'Origin',
    valuation: 'Customs valuation (CIF)',
    goods: 'Goods value',
    freight: 'Freight',
    insurance: 'Insurance',
    customsValue: 'Customs value',
    estimatedDuty: 'Estimated duty',
    estimateNote:
      'Duty shown is an estimate produced from the tariff in force on the date given, matched by HS ' +
      'prefix. It is not an assessment and carries no authority. The assessed figure is whatever the ' +
      'authority determines on filing, and the declaration number and duty should be recorded back ' +
      'against this job once it is available.',
    unmatched: 'No tariff line was found for the following codes, so no duty is estimated for them',
    asOf: 'Tariff as at',
    forFiling: 'Fields required for filing are complete unless marked otherwise.',
  },
  ar: {
    title: 'ملف البيان الجمركي',
    subtitle: 'مستند عمل — أُعدّ لوكيل التخليص',
    importer: 'المستورد المسجّل',
    supplier: 'المورّد / الشاحن',
    broker: 'وكيل التخليص',
    shipment: 'الإرسالية',
    houseBill: 'البوليصة الفرعية',
    masterBill: 'البوليصة الرئيسية',
    vessel: 'الباخرة / الرحلة',
    flight: 'رقم الرحلة',
    arrival: 'الوصول',
    origin: 'بلد المنشأ',
    load: 'ميناء الشحن',
    discharge: 'ميناء التفريغ',
    incoterm: 'شرط التسليم',
    declarationType: 'نوع البيان',
    declarationNo: 'رقم البيان',
    line: 'م',
    description: 'وصف البضاعة',
    hs: 'البند الجمركي',
    packages: 'الطرود',
    net: 'الصافي (كجم)',
    gross: 'الإجمالي (كجم)',
    value: 'القيمة',
    rate: 'النسبة',
    duty: 'الرسوم (تقديري)',
    countryOrigin: 'المنشأ',
    valuation: 'التقييم الجمركي (سيف)',
    goods: 'قيمة البضاعة',
    freight: 'أجرة الشحن',
    insurance: 'التأمين',
    customsValue: 'القيمة الجمركية',
    estimatedDuty: 'الرسوم التقديرية',
    estimateNote:
      'الرسوم المبيّنة تقديرية، احتُسبت وفق التعرفة السارية في التاريخ المذكور ومطابقة ببادئة البند ' +
      'الجمركي. وهي ليست ربطاً جمركياً ولا تحمل أي صفة رسمية. والقيمة المعتمدة هي ما تقرره الإدارة عند ' +
      'التقديم، ويُسجّل رقم البيان والرسوم على هذه الوظيفة فور توفرهما.',
    unmatched: 'لم يُعثر على بند تعرفة للأكواد التالية، فلم تُقدَّر رسوم لها',
    asOf: 'التعرفة بتاريخ',
    forFiling: 'الحقول اللازمة للتقديم مكتملة ما لم يُشر إلى خلاف ذلك.',
  },
} as const

export function renderCustomsPackHtml(view: CustomsPackView, locale: DocumentLocale): string {
  const t = STRINGS[locale]
  const job = view.job
  const air = job.mode === 'air'
  const money = (value: string | null): string =>
    value === null ? '—' : esc(formatMoney(value, view.currency, locale))

  const rows = view.lines
    .map(
      (line) => `<tr>
    <td class="n">${line.lineNo}</td>
    <td>${escBlock(line.description)}</td>
    <td>${esc(line.hsCode ?? '—')}${line.matchedPrefix ? `<br><span class="muted">${esc(line.matchedPrefix)}</span>` : ''}</td>
    <td>${esc(line.countryOfOrigin ?? '—')}</td>
    <td class="n">${line.packageCount ?? '—'}</td>
    <td class="n">${formatQuantity(line.netWeightKg, locale)}</td>
    <td class="n">${formatQuantity(line.grossWeightKg, locale)}</td>
    <td class="n">${money(line.value)}</td>
    <td class="n">${line.ratePercent === null ? '—' : `${esc(line.ratePercent)}%`}</td>
    <td class="n">${money(line.duty)}</td>
  </tr>`,
    )
    .join('')

  return page(
    locale,
    `
${letterhead(job, t.title, `${t.subtitle} · ${esc(job.reference)}`, locale)}

<div class="grid">
  ${partyBlock(partyOf(job, 'consignee'), t.importer, locale, job.customer.nameEn)}
  ${partyBlock(partyOf(job, 'shipper'), t.supplier, locale)}
</div>

<div class="row" style="margin-top:4mm">
  ${field(t.broker, esc(view.brokerName ?? '—'))}
  ${field(t.declarationType, esc(view.declarationType ?? '—'))}
  ${field(t.declarationNo, esc(view.declarationNo ?? '—'))}
  ${field(t.incoterm, esc(job.incoterm ?? '—'))}
</div>

<div class="row">
  ${field(t.houseBill, esc(job.houseBillNumber ?? '—'))}
  ${field(t.masterBill, esc(job.masterBillNumber ?? '—'))}
  ${field(air ? t.flight : t.vessel, esc(air ? (job.flightNumber ?? '—') : [job.vesselName, job.voyageNumber].filter(Boolean).join(' / ') || '—'))}
  ${field(t.load, esc(job.origin ? localised(job.origin.nameEn, job.origin.nameAr, locale) : '—'))}
  ${field(t.discharge, esc(job.destination ? localised(job.destination.nameEn, job.destination.nameAr, locale) : '—'))}
  ${field(t.arrival, esc(formatDate(job.eta, locale)))}
</div>

<table>
  <thead><tr>
    <th class="n" style="width:4%">${t.line}</th>
    <th>${t.description}</th>
    <th style="width:12%">${t.hs}</th>
    <th style="width:8%">${t.countryOrigin}</th>
    <th class="n" style="width:6%">${t.packages}</th>
    <th class="n" style="width:9%">${t.net}</th>
    <th class="n" style="width:9%">${t.gross}</th>
    <th class="n" style="width:11%">${t.value}</th>
    <th class="n" style="width:6%">${t.rate}</th>
    <th class="n" style="width:11%">${t.duty}</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class="row" style="margin-top:5mm">
  <div class="field">
    <span class="label">${t.valuation}</span>
    <table style="margin-top:1mm; width:70mm">
      <tr><td>${t.goods}</td><td class="n">${money(view.goodsValue)}</td></tr>
      <tr><td>${t.freight}</td><td class="n">${money(view.freightValue)}</td></tr>
      <tr><td>${t.insurance}</td><td class="n">${money(view.insuranceValue)}</td></tr>
      <tr><td><strong>${t.customsValue}</strong></td><td class="n"><strong>${money(view.customsValue)}</strong></td></tr>
      <tr><td><strong>${t.estimatedDuty}</strong></td><td class="n"><strong>${money(view.estimatedDuty)}</strong></td></tr>
    </table>
  </div>
  <div class="field">
    ${field(t.asOf, esc(formatDate(view.estimatedAt, locale)))}
  </div>
</div>

${
  view.unmatched.length > 0
    ? `<div class="terms"><strong>${esc(t.unmatched)}:</strong> ${view.unmatched.map(esc).join(', ')}</div>`
    : ''
}

<div class="terms">${esc(t.estimateNote)}</div>
`,
    `@page { size: A4 landscape; margin: 12mm; }`,
  )
}
